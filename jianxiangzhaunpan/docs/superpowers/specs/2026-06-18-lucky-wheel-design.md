# Lucky Wheel System Design

## Goal

Build a Railway-deployable lottery wheel system with a public draw page and a password-protected admin panel.

## Scope

- Public users enter a lottery code, preview the wheel prizes, and start one draw.
- The server validates the code and calculates the result. The browser never decides the winning prize.
- Admin users log in with the initial account `admin` and password `admin`.
- Admin users can create lottery codes, configure prize names, prize images, probability weights, stock, and active status.
- Admin users can upload prize images and review draw records.
- Draw records include the server-visible client IP, forwarded IP header, browser user agent, code, prize, and timestamp.

## Privacy And IP Boundary

The system records the IP address visible to the server and trusted proxy headers. It cannot bypass VPNs, proxies, carrier NAT, or browser privacy protections to reveal an absolute physical IP address. The public page includes a notice that participation records server-visible IP and browser information for anti-abuse auditing.

## Architecture

- Node.js and Express serve the HTML pages and JSON APIs.
- SQLite stores campaigns, prizes, draw logs, and admin sessions.
- Uploaded images are stored under `uploads/` and served as static assets.
- Railway can run the app with `npm start`; persistent SQLite storage should use a Railway volume and `DATABASE_PATH`.

## Data Model

- `campaigns`: code, title, max uses, used count, expiration, active flag.
- `prizes`: campaign id, name, image URL, probability weight, stock, won count, sort order.
- `draws`: campaign id, code, prize id, prize name, IP, forwarded IP, user agent, created time.

## Error Handling

- Invalid or inactive codes return a friendly error.
- Exhausted codes return a friendly error.
- If configured prize stock is exhausted, that prize is ignored for future draws.
- Admin APIs require an authenticated session.
- Prize probability must be positive, and at least one prize must be drawable.

## Testing

- Unit tests cover code generation, weighted prize selection, stock filtering, and input validation.
- API smoke tests cover login, campaign creation, public validation, draw creation, and admin log reads.
