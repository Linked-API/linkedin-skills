// Interactive frontend (human at a terminal). Drives the same core as the headless path.
import { buildTargets, gatherSnapshot } from './plan.mjs';
import { installSkill } from './install.mjs';
import { installCli, runSetup } from './prereqs.mjs';
import * as prompts from './prompts.mjs';
import { getSkill, packageVersion } from './registry.mjs';

export async function runInteractive(ctx) {
  try {
    await wizard(ctx);
  } catch (err) {
    if (err instanceof prompts.PromptCancelled) {
      prompts.cancel('Cancelled.');
      process.exit(130);
    }
    throw err;
  }
}

async function wizard(ctx) {
  prompts.intro('Linked API Skills Installer');

  const scan = prompts.spinner();
  scan.start('Scanning your environment');
  const snap = await gatherSnapshot(ctx);
  scan.stop(
    `Node ${snap.node}${snap.nodeOk ? '' : ' — need ≥20!'} · ${snap.os}/${snap.arch}` +
      (snap.git.inRepo ? ' · git repo' : ''),
  );

  const detectedIds = snap.agents.filter((a) => a.detected).map((a) => a.id);
  const allSkillIds = snap.skills.map((s) => s.name);
  const defaultScope = snap.git.inRepo ? 'project' : 'global';

  let agentIds;
  let skillIds;
  let scope;

  // Fast path: pre-pick detected agents + all skills and confirm with one Yes/No, so the common
  // case is just Enter — no need to know about the space key. "No" → per-item Yes/No questions.
  let chooseManually = detectedIds.length === 0;
  if (detectedIds.length > 0) {
    const installAll = await prompts.confirm({
      message: `Install ${allSkillIds.join(', ')} into ${detectedIds.join(', ')} (${defaultScope} scope)?`,
      active: 'Yes, install all',
      inactive: 'No, let me choose',
      initialValue: true,
    });
    if (installAll) {
      agentIds = detectedIds;
      skillIds = allSkillIds;
      scope = defaultScope;
    } else {
      chooseManually = true;
    }
  } else {
    prompts.note('No supported agents detected — choose manually below.', 'Heads up');
  }

  if (chooseManually) {
    skillIds = await pickByConfirm(
      snap.skills.map((s) => ({ id: s.name, message: `Install the "${s.name}" skill?`, on: true })),
    );
    if (skillIds.length === 0) {
      prompts.cancel('No skills selected — nothing to do.');
      return;
    }
    agentIds = await pickByConfirm(
      snap.agents.map((a) => ({
        id: a.id,
        message: `Install into ${agentLabel(a)}?`,
        on: a.detected,
      })),
    );
    if (agentIds.length === 0) {
      prompts.cancel('No agents selected — nothing to do.');
      return;
    }
    scope = await prompts.select({
      message: 'Install scope?',
      options: [
        { value: 'project', label: 'Project', hint: snap.git.inRepo ? 'this repository' : 'current directory' },
        { value: 'global', label: 'Global', hint: 'all your projects (~)' },
      ],
      initialValue: defaultScope,
    });
  }

  await ensurePrereqs(snap);

  let enableScheduler = false;
  if (skillIds.includes('network-growth')) {
    enableScheduler = await prompts.confirm({
      message: 'Enable the network-growth background scheduler now (sends invites on a schedule)?',
      initialValue: false,
    });
  }

  const version = packageVersion();
  for (const name of skillIds) {
    const skill = getSkill(name);
    const targets = buildTargets(skill, agentIds, scope, ctx);
    const sp = prompts.spinner();
    sp.start(`Installing ${name}`);
    const result = await installSkill(skill, targets, {
      mode: 'copy',
      dryRun: false,
      enableOptional: name === 'network-growth' && enableScheduler,
      home: ctx.home,
      version,
    });
    sp.stop(result.ok ? `Installed ${name}` : `Installed ${name} with warnings — run \`doctor\``);
  }

  prompts.outro('Done. Restart your agent — skills load at startup.');
}

function agentLabel(agent) {
  if (agent.detected) return `${agent.label} (detected)`;
  return agent.nativeSkills ? agent.label : `${agent.label} (imported as rules)`;
}

async function pickByConfirm(items) {
  const chosen = [];
  for (const item of items) {
    const yes = await prompts.confirm({ message: item.message, initialValue: item.on });
    if (yes) chosen.push(item.id);
  }
  return chosen;
}

async function ensurePrereqs(snap) {
  if (!snap.linkedinCli.installed) {
    const install = await prompts.confirm({
      message: '@linkedapi/linkedin-cli is required but not installed. Install it globally now?',
    });
    if (install) {
      const sp = prompts.spinner();
      sp.start('Installing @linkedapi/linkedin-cli');
      const res = await installCli();
      sp.stop(
        res.ok
          ? 'linkedin-cli installed'
          : 'Could not install — run `npm i -g @linkedapi/linkedin-cli` manually',
      );
    }
  }

  if (!snap.tokens.configured) {
    const choice = await prompts.select({
      message: 'No Linked API tokens found. Connect an account now?',
      options: [
        { value: 'enter', label: 'Enter tokens now' },
        { value: 'browser', label: 'Open app.linkedapi.io first' },
        { value: 'skip', label: 'Skip for now' },
      ],
      initialValue: 'enter',
    });
    if (choice === 'browser') {
      prompts.note(
        'Open https://app.linkedapi.io , connect your LinkedIn account, then copy both tokens.',
        'Get your tokens',
      );
    }
    if (choice === 'enter' || choice === 'browser') {
      const linkedApiToken = await prompts.password({ message: 'Linked API token' });
      const identificationToken = await prompts.password({ message: 'Identification token' });
      if (linkedApiToken && identificationToken) {
        const sp = prompts.spinner();
        sp.start('Saving tokens');
        const res = await runSetup({ linkedApiToken, identificationToken });
        sp.stop(res.ok ? 'Account connected' : 'Setup failed — verify tokens at app.linkedapi.io');
      }
    }
  }
}
