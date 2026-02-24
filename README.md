# linkedin-skills

A collection of LinkedIn skills for AI agents. Each skill provides structured instructions that enable AI agents to perform LinkedIn tasks effectively.

All skills are powered by [LinkedIn CLI](https://github.com/Linked-API/linkedin-cli) (`@linkedapi/linkedin-cli`) — a command-line tool for LinkedIn automation via [Linked API](https://linkedapi.io).

## Available Skills

| Skill | Description |
|-------|-------------|
| [linkedin-cli](skills/linkedin-cli.md) | General-purpose LinkedIn automation — fetch profiles, search people and companies, send messages, manage connections, create posts, and more |

## Usage

Copy the skill file content into your AI agent's system prompt, `CLAUDE.md`, or any other instruction source your agent supports.

## Prerequisites

```bash
npm install -g @linkedapi/linkedin-cli
linkedin setup
```
