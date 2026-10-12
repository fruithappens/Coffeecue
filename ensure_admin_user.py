#!/usr/bin/env python3
"""
Make sure there is an admin to log in with -- WITHOUT ever touching one
that already exists.

Runs at every boot (run_server.py, wsgi.py).

It used to call create_admin(force=True), which DELETES the existing
admin and recreates it with DEFAULT_ADMIN_PASSWORD -- or 'adminpassword'
when that isn't set. On cupq.app it wasn't set, so every deploy put the
admin back to a password printed in the public repo, threw away any
password changed in the app (why "change the admin password" never
stuck), and dropped that user's personal unlock PIN with the row.

Now:
  * the admin already exists        -> left exactly as it is
  * it doesn't, password env is set -> created with that password
  * it doesn't, no password env:
      - on a server (Railway / APP_ENV=production) -> a random password,
        printed ONCE in the deploy log; never a default
      - on a laptop                                -> 'adminpassword',
        the local test login
"""

import os
import secrets


def _on_a_server():
    return bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PUBLIC_DOMAIN")) or (
        os.getenv("APP_ENV", "").lower() == "production"
    )


def _exists(db_url, username, email):
    """(username taken, email taken). Never raises: a failed check means
    'don't create', so boot can't clobber anything on a bad read."""
    import psycopg2

    conn = None
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute(
            "SELECT to_regclass('public.users') IS NOT NULL")
        if not cur.fetchone()[0]:
            return (False, False)
        cur.execute("SELECT 1 FROM users WHERE username = %s", (username,))
        u = cur.fetchone() is not None
        cur.execute("SELECT 1 FROM users WHERE email = %s", (email,))
        e = cur.fetchone() is not None
        conn.rollback()
        return (u, e)
    except Exception as ex:
        print(f"WARNING: could not check for the admin user ({ex}); not creating one")
        return (True, True)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def main():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("WARNING: No DATABASE_URL found, skipping admin user creation")
        return

    username = os.getenv("DEFAULT_ADMIN_USERNAME", "coffeecue")
    email = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@coffeecue.com")

    user_taken, email_taken = _exists(db_url, username, email)
    if user_taken:
        print(f"Admin user '{username}' exists; left as it is.")
        return
    if email_taken:
        print(f"WARNING: email {email} belongs to another user; not creating '{username}'.")
        return

    password = os.getenv("DEFAULT_ADMIN_PASSWORD")
    generated = False
    if not password:
        if _on_a_server():
            password = secrets.token_urlsafe(12)
            generated = True
        else:
            password = "adminpassword"  # the local test login (CLAUDE.md)

    try:
        from create_admin import create_admin

        if create_admin(db_url, username, email, password, force=False):
            print(f"Admin user '{username}' created.")
            if generated:
                # Once, here, and nowhere else: only its hash is stored.
                print("=" * 64)
                print(f"FIRST ADMIN LOGIN for this server: {username} / {password}")
                print("Change it in Runner > People after logging in.")
                print("=" * 64)
        else:
            print(f"Admin user '{username}' was not created.")
    except Exception as e:
        print(f"Error ensuring admin user: {e}")  # never fail the boot


if __name__ == "__main__":
    main()
