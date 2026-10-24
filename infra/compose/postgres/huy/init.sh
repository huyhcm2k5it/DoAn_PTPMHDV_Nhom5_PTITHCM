#!/bin/sh
set -eu
# Entrypoint runs this only on a new volume. psql variables quote identifiers/literals.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=catalog_password="$CATALOG_DB_PASSWORD" \
  --set=clinical_password="$CLINICAL_DB_PASSWORD" \
  --set=diagnostic_password="$DIAGNOSTIC_DB_PASSWORD" <<'SQL'
CREATE ROLE catalog_owner LOGIN PASSWORD :'catalog_password';
CREATE ROLE clinical_owner LOGIN PASSWORD :'clinical_password';
CREATE ROLE diagnostic_owner LOGIN PASSWORD :'diagnostic_password';
CREATE DATABASE catalog_db OWNER catalog_owner;
CREATE DATABASE clinical_db OWNER clinical_owner;
CREATE DATABASE diagnostic_db OWNER diagnostic_owner;
REVOKE ALL ON DATABASE catalog_db FROM PUBLIC;
REVOKE ALL ON DATABASE clinical_db FROM PUBLIC;
REVOKE ALL ON DATABASE diagnostic_db FROM PUBLIC;
SQL
