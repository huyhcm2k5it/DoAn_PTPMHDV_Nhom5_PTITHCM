-- 1. Identity Service DB
CREATE USER identity_owner WITH PASSWORD 'identity@123';
CREATE DATABASE identity_db OWNER identity_owner;
GRANT ALL PRIVILEGES ON DATABASE identity_db TO identity_owner;

-- 2. Billing Service DB
CREATE USER billing_owner WITH PASSWORD 'billing@123';
CREATE DATABASE billing_db OWNER billing_owner;
GRANT ALL PRIVILEGES ON DATABASE billing_db TO billing_owner;

-- 3. Notification Service DB
CREATE USER notification_owner WITH PASSWORD 'notification@123';
CREATE DATABASE notification_db OWNER notification_owner;
GRANT ALL PRIVILEGES ON DATABASE notification_db TO notification_owner;