#!/bin/sh
set -eu
# New-volume bootstrap only. Never drop an existing owner database.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=owner_password="$IDENTITY_DB_PASSWORD" <<'SQL'
CREATE ROLE identity_owner LOGIN PASSWORD :'owner_password';
CREATE DATABASE identity_db OWNER identity_owner;
REVOKE ALL ON DATABASE identity_db FROM PUBLIC;
SQL
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=owner_password="$BILLING_DB_PASSWORD" <<'SQL'
CREATE ROLE billing_owner LOGIN PASSWORD :'owner_password';
CREATE DATABASE billing_db OWNER billing_owner;
REVOKE ALL ON DATABASE billing_db FROM PUBLIC;
SQL
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=owner_password="$NOTIFICATION_DB_PASSWORD" <<'SQL'
CREATE ROLE notification_owner LOGIN PASSWORD :'owner_password';
CREATE DATABASE notification_db OWNER notification_owner;
REVOKE ALL ON DATABASE notification_db FROM PUBLIC;
SQL
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=owner_password="$CATALOG_DB_PASSWORD" <<'SQL'
CREATE ROLE catalog_owner LOGIN PASSWORD :'owner_password';
CREATE DATABASE catalog_db OWNER catalog_owner;
REVOKE ALL ON DATABASE catalog_db FROM PUBLIC;
SQL
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=owner_password="$CLINICAL_DB_PASSWORD" <<'SQL'
CREATE ROLE clinical_owner LOGIN PASSWORD :'owner_password';
CREATE DATABASE clinical_db OWNER clinical_owner;
REVOKE ALL ON DATABASE clinical_db FROM PUBLIC;
SQL
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=owner_password="$DIAGNOSTIC_DB_PASSWORD" <<'SQL'
CREATE ROLE diagnostic_owner LOGIN PASSWORD :'owner_password';
CREATE DATABASE diagnostic_db OWNER diagnostic_owner;
REVOKE ALL ON DATABASE diagnostic_db FROM PUBLIC;
SQL
