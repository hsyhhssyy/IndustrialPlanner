# Task Completion Checklist

## After Code Changes

### 1. Code Quality Check
- [ ] Run code linting tools (e.g., linter)
- [ ] Run type checking (if applicable)
- [ ] Manually test modified functionality

### 2. Testing
- [ ] Run unit tests
- [ ] Run integration tests (if applicable)
- [ ] Test edge cases

### 3. Code Review Points
- [ ] Check if code conventions are followed
- [ ] Check if naming is clear
- [ ] Check if error handling is complete
- [ ] Check if sensitive information is exposed

### 4. Pre-Commit Check
- [ ] Confirm sensitive files won't be committed
- [ ] Confirm no debug code
- [ ] Confirm no commented code
- [ ] Write clear commit message

## After New Feature Development

### 1. Feature Testing
- [ ] Local development environment testing
- [ ] Edge case testing
- [ ] Performance testing (if needed)

### 2. Documentation Update
- [ ] Update README.md (if needed)
- [ ] Add/update API documentation
- [ ] Update configuration documentation (if needed)

### 3. Deployment Preparation
- [ ] Update version number (if applicable)
- [ ] Prepare migration scripts (if needed)
- [ ] Test deployment process

## Pre-Release Final Check

- [ ] All tests pass
- [ ] No console errors
- [ ] Performance metrics normal
- [ ] Rollback plan ready
