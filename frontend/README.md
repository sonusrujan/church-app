# Church Management Frontend

React + TypeScript + Vite UI for Church Subscription Management.

## Environment

Create `.env` in this folder using `.env.example`:

```bash
VITE_API_URL=http://localhost:4000
```

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Features

- Google OAuth sign-in
- Profile sync (`/api/auth/sync-profile`)
- Profile context view (`/api/auth/me`)
- Admin management (`/api/admins/list`, `/api/admins/grant`, `/api/admins/revoke`)
- Announcement publishing (`/api/announcements/send`)

## Notes

- Ensure backend is running at `VITE_API_URL`.
- Add `http://localhost:5173` and your deploy URL to Google OAuth redirect URLs.
