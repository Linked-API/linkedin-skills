# linkedin-skills

A collection of LinkedIn skills for AI agents. Each skill is a folder with a `SKILL.md` file that provides structured instructions for AI agents.

All skills are powered by [LinkedIn CLI](https://github.com/Linked-API/linkedin-cli) (`@linkedapi/linkedin-cli`) — a command-line tool for LinkedIn automation via [Linked API](https://linkedapi.io).

## Available Skills

| Skill | Description |
|-------|-------------|
| [linkedin](linkedin/) | General-purpose LinkedIn automation — fetch profiles, search people and companies, send messages, manage connections, create posts, and more |

## Usage

Copy the skill folder into your `.claude/skills/` directory (project-level) or `~/.claude/skills/` (global).

## Prerequisites

```bash
npm install -g @linkedapi/linkedin-cli
linkedin setup
```
