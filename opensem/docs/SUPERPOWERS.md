# Superpowers Skills Reference

This document lists the Superpowers skills relevant to OpenSem.

## Core Skills

### using-superpowers
**Purpose**: Learn how to use the skills system

You must understand this skill before using any other skills. It explains:
- How to access skills
- When to use skills
- Skill priority
- Skill types

**When to use**: At the start of every new conversation

### brainstorming
**Purpose**: Creative ideation before creating features or building components

Workflow:
1. Understand project context
2. Ask questions one at a time to refine ideas
3. Present 2-3 different approaches
4. Show design in sections and confirm

**When to use**: Before creating new features, building components, or adding capabilities

### writing-plans
**Purpose**: Convert specifications or requirements into detailed implementation plans

Workflow:
1. Analyze requirement documents
2. Break down into executable steps
3. Identify key files
4. Consider architectural trade-offs
5. Write plan document

**When to use**: When you have specifications that need to be implemented

## Development Workflow Skills

### test-driven-development
**Purpose**: Write tests before implementing features or fixing bugs

Workflow:
1. Write failing test
2. Run test to confirm failure
3. Write minimum code to pass test
4. Refactor code
5. Repeat

**When to use**: Implementing any feature or bugfix

### systematic-debugging
**Purpose**: Use when encountering bugs, test failures, or unexpected behavior

Workflow:
1. Understand the problem
2. Generate hypotheses
3. Design experiments
4. Execute experiments
5. Analyze results
6. Repeat or fix

**When to use**: Encountering any bug, test failure, or unexpected behavior

### verification-before-completion
**Purpose**: Verify before claiming work is complete

Checklist:
- Is the functionality fully implemented?
- Do tests pass?
- Are edge cases handled?
- Is documentation updated?
- Has code been reviewed?

**When to use**: Before committing or claiming completion

## Code Review Skills

### requesting-code-review
**Purpose**: Request code review after completing tasks

Workflow:
1. Ensure work is complete
2. Self-check code
3. Request review
4. Iterate based on feedback

**When to use**: After completing important tasks or before merging

### receiving-code-review
**Purpose**: Receive code review feedback

Workflow:
1. Understand feedback
2. Distinguish must-fix from suggested changes
3. Create modification plan
4. Implement changes

**When to use**: After receiving code review feedback

## Claude Code Development Skills

### working-with-claude-code
**Purpose**: Using Claude Code CLI, plugins, hooks, etc.

Covers:
- Claude Code command-line usage
- Plugin development
- Hook configuration
- MCP servers
- Skill management

### developing-claude-code-plugins
**Purpose**: Developing Claude Code plugins

Covers:
- Plugin structure
- Plugin development
- Plugin testing
- Plugin release

## Using with Serena

### Typical Workflows

1. **Project Initialization**
   ```
   → Use OpenSem to configure project
   → Serena activates project
   → Use brainstorming to plan features
   → Use writing-plans to create implementation plan
   ```

2. **Feature Development**
   ```
   → Use test-driven-development to write tests
   → Implement code (Serena assisted)
   → Use systematic-debugging to debug issues
   → Use verification-before-completion to verify
   → Use requesting-code-review to review code
   ```

3. **Bug Fixing**
   ```
   → Use systematic-debugging to diagnose issues
   → Fix code (Serena assisted)
   → Verify fix
   → Update documentation
   ```

## Skill Priority

When multiple skills might apply, use this order:

1. **Process skills** (brainstorming, debugging) - determine how to approach task
2. **Implementation skills** (frontend-design, mcp-builder) - guide execution

## More Skills

See the full skills library:
- https://github.com/obra/superpowers

## Contributing New Skills

If you want to contribute new skills to Superpowers:
1. Reference the writing-skills skill
2. Follow the skill template structure
3. Submit PR to Superpowers repository
