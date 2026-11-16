#!/usr/bin/env bash
# Local RLS test runner. Needs a throw-away local Postgres (never a real Supabase project).
# Example:  PGHOST=localhost PGPORT=5432 PGUSER=postgres ./run_tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=rinova_rls_test
psql -q -c "drop database if exists $DB" -c "create database $DB"
for f in tests/00_supabase_shim.sql migrations/0*.sql; do psql -q -d $DB -v ON_ERROR_STOP=1 -f "$f"; done
psql -q -d $DB -v ON_ERROR_STOP=1 -f tests/10_rls_tests.sql
