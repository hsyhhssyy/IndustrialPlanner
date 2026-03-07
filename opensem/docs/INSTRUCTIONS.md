# Claude Code Instructions

This document provides instructions for Claude Code on how to configure and understand the OpenSem workflow.

## System Overview

OpenSem is an AI-native configuration template system designed specifically for Claude Code. It combines open-source philosophy with semantic code analysis to provide an intelligent approach to project configuration.

## Core Principles

1. **AI-First** - Configurations are understood and applied by Claude Code, no scripts needed
2. **Conversation-Driven** - Determine optimal configuration through dialogue
3. **Self-Contained** - Single folder copy, ready to use
4. **Extensible** - Follow standards, let AI handle the rest

## Configuration File Structure

### configs/*.yml

Each YAML configuration file contains:

- `project_name`: Project name (leave empty, AI will fill)
- `languages`: List of language servers
- `encoding`: File encoding (typically utf-8)
- `ignore_all_files_in_gitignore`: Whether to use .gitignore
- `ignored_paths`: Additional paths to ignore
- `read_only`: Read-only mode
- `excluded_tools`: Excluded tools (usually empty)
- `base_modes`: List of base modes
- `default_modes`: List of default modes
- `initial_prompt`: Project initialization prompt

### templates/*.md

Memory templates are Markdown files for storing project-specific knowledge:

- `project_overview.md` - Project overview
- `tech_stack.md` - Technology stack
- `code_conventions.md` - Code conventions
- `project_structure.md` - Project structure
- `suggested_commands.md` - Common commands
- `task_checklist.md` - Task checklist

## Claude Code Usage Flow

When a user says "Use OpenSem to configure my project":

1. **Ask Project Type**
   - Web frontend / Backend API / Full-stack / Other?

2. **Select Configuration**
   - Select appropriate YAML config based on project type
   - Or dynamically generate based on existing configs

3. **Create .serena Directory**
   - Copy selected config to .serena/project.yml
   - Create .serena/memories/ directory
   - Copy template files to memories/

4. **Activate Project**
   - Use Serena's activate_project tool

5. **Guide User to Fill Templates**
   - Prompt user to modify memory templates based on their situation
   - Can be done all at once or gradually

## Language Server Mapping

| Config Key | LSP Server | Supported Files |
|------------|------------|-----------------|
| `typescript` | typescript | .ts, .tsx, .js, .jsx |
| `python` | python | .py |
| `go` | go | .go |
| `rust` | rust | .rs |
| `java` | java | .java |
| `kotlin` | kotlin | .kt, .kts |
| `csharp_omnisharp` | csharp_omnisharp | .cs |
| `ruby_solargraph` | ruby_solargraph | .rb |
| `php` | intelephense | .php |
| `swift` | sourcekit-lsp | .swift |
| `dart` | dart | .dart |
| `solidity` | solidity | .sol |
| `cpp` | cpp | .c, .cpp, .h, .hpp |

## Common Tasks

### Analyze Existing Project

```
"Analyze this project's structure"
→ Claude Code uses Serena's tools to analyze code
→ Automatically suggests appropriate configuration
→ Generates project.yml and memory templates
```

### Create New Project

```
"Create a TypeScript React project"
→ Claude Code uses typescript.yml configuration
→ Creates standard directory structure
→ Initializes memory templates
```

### Switch Configuration Mode

```
"Switch to read-only mode"
→ Claude Code modifies read_only setting in project.yml
→ Restarts language server
```

## Important Notes

1. **Don't Modify User Code** - Unless explicitly requested
2. **Confirm Actions** - Confirm before important operations
3. **Progressive Configuration** - Start simple, improve gradually
4. **Keep Templates Generic** - Templates should apply to broad scenarios
