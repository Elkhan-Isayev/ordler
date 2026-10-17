# Installing Ordler

Ordler is one container image. The only thing it needs is **PostgreSQL 18 or newer** with an
empty database; Ordler creates every table itself and upgrades them on later versions.

## 1. Prepare the database

On your PostgreSQL server (self-hosted, AWS RDS, Azure, Cloud SQL), as an administrator:

```sql
CREATE USER ordler WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE ordler OWNER ordler;
```

The user needs no superuser rights: owning the database (or `CREATE` on it) is enough.
Ordler keeps its tables in the `ordler` schema, so the database can be shared with other
applications.

## 2. Run Ordler

### Docker Compose

```bash
curl -O https://raw.githubusercontent.com/Elkhan-Isayev/ordler/main/deploy/docker-compose.yml
BASE_URL=https://tasks.company.com docker compose up -d
docker compose logs ordler
```

Open `BASE_URL`. The first page asks for the database connection and the **install token**
printed in the log. Ordler checks the connection, creates its tables and continues with the
setup wizard, where you create the workspace and the first administrator (Owner).

No PostgreSQL yet? The Compose file can start one next to Ordler; enter `postgres` as the host
on the install page:

```bash
POSTGRES_PASSWORD=choose-a-strong-password docker compose --profile with-postgres up -d
```

### Docker

```bash
docker run -d --name ordler --restart unless-stopped \
  -p 3000:3000 -e BASE_URL=https://tasks.company.com \
  -v ordler-data:/data ghcr.io/elkhan-isayev/ordler:latest
```

### Kubernetes (Helm)

With the database in values (recommended, allows several replicas):

```bash
helm install ordler oci://ghcr.io/elkhan-isayev/charts/ordler \
  --set baseUrl=https://tasks.company.com \
  --set database.host=ordler.xxxx.eu-central-1.rds.amazonaws.com \
  --set database.existingSecret=ordler-db --set database.ssl=verify-full \
  --set-file database.sslCa=global-bundle.pem \
  --set ingress.enabled=true --set ingress.host=tasks.company.com
```

Without `database.host`, the chart runs one replica with a persistent volume and Ordler shows
the install page; get the token with `kubectl logs deploy/ordler`.

## 3. Skip the install page (optional)

Set the connection through environment variables instead, e.g. in the Compose file:

```yaml
DATABASE_URL: postgres://ordler:password@db.company.com:5432/ordler
DB_SSL: require
```

Settings from environment variables are shown read-only in **Administration → Database**.
Settings entered on the install page can be changed there by an Owner; they apply after a
restart.

## 4. After installation

- **Administration → Mail server**: SMTP for sign-in codes, invitations and notifications,
  with a test email.
- **Administration → Sign-in**: email and password, one-time codes by email, Google.
- **Administration → Members**: invite people and grant roles.

## Backups

Back up two things together:

1. The PostgreSQL database (RDS snapshots or `pg_dump`). It holds everything, including
   attached files and pasted screenshots, so plan storage for them (25 MB per file at most,
   `ATTACHMENT_MAX_MB`).
2. The `/data` volume, or the `ENCRYPTION_KEY` if you set one. It encrypts stored secrets:
   the database password from the install page, SMTP and Google credentials.

## Upgrades

Take a database snapshot, then change the image tag:

```bash
docker compose pull && docker compose up -d
helm upgrade ordler oci://ghcr.io/elkhan-isayev/charts/ordler --reuse-values --version X.Y.Z
```

Ordler applies pending migrations on start, in one transaction, once across replicas. It never
deletes data during an upgrade and refuses to start on a database written by a newer version.

## Configuration reference

See [SPEC §16.2](SPEC.md#162-configuration-environment-variables).
