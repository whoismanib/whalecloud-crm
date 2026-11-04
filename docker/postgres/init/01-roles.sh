#!/bin/sh
# Creates the owner (migrations) and app (runtime) roles, the app database and, in dev, the
# test database. Runs once on first container start (docker-entrypoint-initdb.d) or manually:
#   POSTGRES_USER=postgres POSTGRES_DB=wcrm DB_OWNER_PASSWORD=... DB_APP_PASSWORD=... \
#   PGHOST=localhost PGPORT=5433 sh docker/postgres/init/01-roles.sh
set -eu
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=wcrm}"
: "${DB_OWNER_USER:=wcrm_owner}"
: "${DB_OWNER_PASSWORD:=change-me-owner}"
: "${DB_APP_USER:=wcrm_app}"
: "${DB_APP_PASSWORD:=change-me-app}"
: "${CREATE_TEST_DB:=true}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_OWNER_USER}') THEN
      CREATE ROLE ${DB_OWNER_USER} LOGIN PASSWORD '${DB_OWNER_PASSWORD}' CREATEDB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_APP_USER}') THEN
      CREATE ROLE ${DB_APP_USER} LOGIN PASSWORD '${DB_APP_PASSWORD}';
    END IF;
  END \$\$;
SQL

create_db() {
  exists=$(psql -tA --username "$POSTGRES_USER" --dbname postgres -c "SELECT 1 FROM pg_database WHERE datname = '$1'")
  if [ "$exists" != "1" ]; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "CREATE DATABASE $1 OWNER ${DB_OWNER_USER}"
  fi
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$1" <<-SQL
    ALTER SCHEMA public OWNER TO ${DB_OWNER_USER};
    GRANT CREATE, CONNECT ON DATABASE $1 TO ${DB_OWNER_USER};
    GRANT CONNECT ON DATABASE $1 TO ${DB_APP_USER};
    GRANT USAGE ON SCHEMA public TO ${DB_APP_USER};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${DB_OWNER_USER} IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${DB_APP_USER};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${DB_OWNER_USER} IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${DB_APP_USER};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${DB_OWNER_USER} IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO ${DB_APP_USER};
SQL
}

create_db "$POSTGRES_DB"
if [ "$CREATE_TEST_DB" = "true" ]; then create_db "${POSTGRES_DB}_test"; fi
