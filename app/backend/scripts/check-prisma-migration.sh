#!/bin/bash

# Check for changes to schema.prisma without corresponding migrations

SCHEMA_FILE="app/backend/prisma/schema.prisma"
MIGRATIONS_DIR="app/backend/prisma/migrations"

# First, check if we're in a git repo
if [ ! -d .git ]; then
    echo "Not a git repository"
    exit 1
fi

# For PRs: compare base and head
if [ -n "$GITHUB_BASE_REF" ] && [ -n "$GITHUB_HEAD_REF" ]; then
    echo "Checking PR: comparing $GITHUB_BASE_REF to $GITHUB_HEAD_REF"
    git fetch origin $GITHUB_BASE_REF $GITHUB_HEAD_REF
    BASE_SHA=$(git rev-parse origin/$GITHUB_BASE_REF)
    HEAD_SHA=$(git rev-parse HEAD)
else
    # For pushes, check current state vs previous commit
    echo "Checking push: comparing HEAD~1 to HEAD"
    BASE_SHA=HEAD~1
    HEAD_SHA=HEAD
fi

# Check if schema.prisma has changed
SCHEMA_CHANGED=$(git diff --name-only $BASE_SHA $HEAD_SHA | grep -q "$SCHEMA_FILE" || true)

if [ -n "$SCHEMA_CHANGED" ]; then
    echo "schema.prisma has changed"
    
    # Check if there are new migration files
    MIGRATION_CHANGED=$(git diff --name-only $BASE_SHA $HEAD_SHA | grep -q "$MIGRATIONS_DIR/.*migration.sql" || true)
    
    if [ -z "$MIGRATION_CHANGED" ]; then
        echo "ERROR: schema.prisma changed but no corresponding migration found!"
        echo "Please run 'pnpm --filter backend run prisma:migrate' to create a migration"
        exit 1
    else
        echo "✅ schema.prisma changed and migration(s) added"
    fi
else
    echo "No changes to schema.prisma"
fi

exit 0
