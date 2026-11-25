# barakahstore.org on the shared VM: runbook

Production (`main` → GitHub Environment `prod`) runs on the Vultr VM that also serves
mediguideapp.com: Ubuntu 24.04, 1 vCPU, about 1 GB RAM plus 2.4 GB swap, nginx behind Cloudflare,
certbot for TLS. Login user `arefin` (sudo asks for a password).

```
Cloudflare ──443──> nginx (sites-enabled/barakahstore) ──> 127.0.0.1:3100  barakah-app  (the CI image)
                                                                             │
CI runner ──ssh tunnel 15432──────────────────────────────> 127.0.0.1:5432  barakah-postgres (volume pgdata)
```

Everything lives in `/opt/barakah`:

| File                                                | Written by                                           | Holds                                   |
| --------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| `docker-compose.yml`, `deploy.sh`, `postgres-init/` | CI, every deploy                                     | the stack definition (from this folder) |
| `.env` (600)                                        | `setup.sh` once; `deploy.sh` updates `BARAKAH_IMAGE` | image tag, Postgres passwords           |
| `app.env` (600)                                     | `setup.sh` once, from `app.env.template`             | the API's environment and secrets       |

Nothing here touches the mediguideapp.com site, its certificates or its systemd units.

## 1. Cloudflare DNS (owner, once)

In the `barakahstore.org` zone:

1. `A` record `barakahstore.org` → `149.28.157.20`, and `CNAME` `www` → `barakahstore.org`.
   Create both as **DNS only** (grey cloud) so certbot can reach the VM in step 2.
2. SSL/TLS → Overview → **Full (strict)**.
3. After step 2 has issued the certificate, switch both records to **Proxied** (orange cloud).

## 2. Set the VM up (owner, once; safe to re-run)

From the repository root on your machine:

```sh
scp -r deploy/vm arefin@149.28.157.20:~/barakah-deploy
ssh -t arefin@149.28.157.20 'sudo bash ~/barakah-deploy/setup.sh'
```

`setup.sh` installs Docker (Ubuntu's `docker.io` + `docker-compose-v2`), adds `arefin` to the
`docker` group, creates `/opt/barakah` with fresh secrets, starts Postgres, installs the nightly
backup timer, enables the nginx site and runs certbot. If certbot fails (DNS not pointing at the VM
yet), fix step 1 and run the command it prints.

Log out and back in once afterwards so `arefin` can use Docker without sudo.

## 3. A deploy key for CI (owner, once)

```sh
ssh-keygen -t ed25519 -f ~/.ssh/barakah_deploy -N "" -C "barakah-ci"
ssh-copy-id -i ~/.ssh/barakah_deploy.pub arefin@149.28.157.20
ssh-keyscan -t ed25519 149.28.157.20      # output goes in VM_KNOWN_HOSTS below
```

A separate key from mediguide's, so either can be revoked alone.

## 4. GitHub environment `prod` (owner, once)

Settings → Environments → `prod`. **Add a required reviewer first**: the deploy job migrates the
production database.

Secrets:

| Name             | Value                                                                              |
| ---------------- | ---------------------------------------------------------------------------------- |
| `VM_HOST`        | `149.28.157.20`                                                                    |
| `VM_USER`        | `arefin`                                                                           |
| `VM_SSH_KEY`     | contents of `~/.ssh/barakah_deploy` (the private key)                              |
| `VM_KNOWN_HOSTS` | the `ssh-keyscan` line from step 3                                                 |
| `DIRECT_URL`     | `postgresql://barakah_app:<APP_DB_PASSWORD>@127.0.0.1:15432/barakah?schema=public` |

Read the password on the VM with `grep APP_DB_PASSWORD /opt/barakah/.env`. The host and port are
the runner's end of the SSH tunnel, not the VM's.

Variable (not secret): `PUBLIC_BASE_URL` = `https://barakahstore.org`.

## 5. Deploy

Push to `main`. After Verify and Publish image, the deploy job:

1. streams the image to the VM over SSH (the VM holds no registry credential);
2. copies this folder's stack files to `/opt/barakah`;
3. opens the tunnel and runs `prisma migrate deploy`, then `prisma/rls/001_enable_rls.sql`;
4. runs `deploy.sh <image>`: swaps the app container, waits for `/api/v1/health/ready`, and puts
   the previous image back if it does not answer (the job then fails);
5. checks `https://barakahstore.org/api/v1/health/ready` through Cloudflare.

## Checks

```sh
ssh arefin@149.28.157.20
cd /opt/barakah && docker compose ps
docker compose logs --tail 100 app
curl -s 127.0.0.1:3100/api/v1/health/ready
free -m                                  # the VM is small; watch swap
systemctl list-timers barakah-db-backup.timer
```

## Operations

- **Roll back:** `bash /opt/barakah/deploy.sh ghcr.io/araf488/barakah_bazaar:sha-<previous>`. The
  previous image stays on the VM after each deploy; older ones are removed. Migrations are not
  rolled back.
- **Change a setting:** edit `/opt/barakah/app.env`, then `cd /opt/barakah && docker compose up -d app`.
- **Restore a backup:** dumps are in `/var/backups/barakah` (14 days). Restore into an empty
  database with
  `docker exec -i barakah-postgres pg_restore -U barakah_admin -d barakah --clean < FILE`. They are
  on the same VM: copy them off the machine too.
- **Storage:** Supabase Storage is optional. Without `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`, admin image uploads are unavailable and health reports storage as
  `disabled`. Set both in `app.env` to enable it.

## Limits to know

- **Memory.** Measured locally: the app about 130 MB at rest, Postgres about 25 MB, capped at
  448 MB and 256 MB. Add Docker (about 80 MB) to mediguide's roughly 350 MB and the VM is close
  to its 955 MB. If `free -m` shows swap climbing, resize the VM to 2 GB.
- **One VM, no redundancy.** A VM outage takes both sites down; a reboot brings both back
  (`restart: unless-stopped`, enabled systemd units).
