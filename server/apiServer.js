// NOTE: this server is purely a dev-mode server. In production,
// server/index.js server also serves the API routes.

// Configure process.env with .env.* files
require('./env').configureEnv();

const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const apiRouter = require('./apiRouter');
const wellKnownRouter = require('./wellKnownRouter');
const webmanifestResourceRoute = require('./resources/webmanifest');
const robotsTxtRoute = require('./resources/robotsTxt');
const sitemapResourceRoute = require('./resources/sitemap');
const paystackVerify = require('./api/paystack/verify');
const paystackCreateTx = require('./api/paystack/create-transaction');

const radix = 10;
const PORT = parseInt(process.env.REACT_APP_DEV_API_SERVER_PORT, radix);
const app = express();

// ⭐⭐⭐ ADD THESE TWO LINES ⭐⭐⭐
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ⭐⭐⭐ END OF REQUIRED FIX ⭐⭐⭐

// NOTE: CORS is only needed in this dev API server because it's
// running in a different port than the main app.
app.use(
  cors({
    origin: process.env.REACT_APP_MARKETPLACE_ROOT_URL,
    credentials: true,
  })
);

app.use(cookieParser());
app.use('/.well-known', wellKnownRouter);
app.use('/api', apiRouter);

// Generate web app manifest
app.get('/site.webmanifest', webmanifestResourceRoute);

// robots.txt and sitemap-* fetches should return similarly compressed data as server/index.js
app.use(compression());

app.get('/robots.txt', robotsTxtRoute);

// Handle different sitemap-* resources. E.g. /sitemap-index.xml
app.get('/sitemap-:resource', sitemapResourceRoute);

// ⭐ Paystack routes
app.post('/api/paystack/verify', paystackVerify);
app.post('/api/paystack/create-transaction', paystackCreateTx);

app.listen(PORT, () => {
  console.log(`API server listening on ${PORT}`);
});
