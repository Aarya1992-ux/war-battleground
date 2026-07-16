# Database setup

1. Get a Postgres database. Easiest options:
   - **Local**: install Postgres, `createdb battleground`
   - **Free hosted**: Supabase, Neon, or Railway all give you a free Postgres instance with a connection URL in ~2 minutes

2. Copy the connection string into `server/.env`:
   ```
   DATABASE_URL=postgresql://user:password@host:5432/battleground
   DATABASE_SSL=true          # set true for hosted DBs (Supabase/Neon/Railway), false for local
   JWT_SECRET=some-long-random-string
   ```

3. Load the schema:
   ```bash
   psql "$DATABASE_URL" -f server/db/schema.sql
   ```
   (Or paste the contents of `schema.sql` into your DB provider's SQL editor.)

4. Start the server as usual — `npm start` inside `server/`. The REST API and the game WebSocket now share the same port.
