import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { z } from 'zod';
import { env } from './config/env';
import { initDb } from './db/database';
import { adminBootstrapGuard, requireAdmin } from './middleware/auth';
import { createAdmin, loginAdmin } from './services/adminService';
import { cancelBooking, createBooking, getBookingByToken, rescheduleBooking } from './services/bookingService';
import { loadAvailabilityConfig } from './config/availability';
import { exchangeCodeForToken, getAuthorizationUrl } from './services/graphService';
import { getSlotsForDate } from './services/slotService';
import { dayjs } from './utils/time';

initDb();
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.resolve(process.cwd(), 'src/views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(adminBootstrapGuard);

const inviteeSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  company: z.string().min(1),
  postalCode: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1)
});

app.get('/', (_req, res) => {
  res.redirect('/book');
});

app.get('/book', async (req, res) => {
  const cfg = loadAvailabilityConfig();
  const date = String(req.query.date ?? dayjs().tz(cfg.timezone).format('YYYY-MM-DD'));
  const slots = await getSlotsForDate(date);
  res.render('book', { date, slots, timezone: cfg.timezone });
});

app.get('/api/slots', async (req, res) => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date);
  const slots = await getSlotsForDate(date);
  res.json({ date, slots });
});

app.post('/api/book', async (req, res) => {
  try {
    const schema = z.object({
      slotStartUtc: z.string().datetime(),
      slotEndUtc: z.string().datetime(),
      timezone: z.string(),
      invitee: inviteeSchema
    });
    const body = schema.parse(req.body);
    const result = await createBooking(body);
    res.json({ ok: true, ...result });
  } catch (error: any) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/reschedule', async (req, res) => {
  try {
    const body = z.object({
      bookingId: z.string(),
      token: z.string(),
      slotStartUtc: z.string().datetime(),
      slotEndUtc: z.string().datetime()
    }).parse(req.body);
    await rescheduleBooking(body.bookingId, body.token, body.slotStartUtc, body.slotEndUtc);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/cancel', async (req, res) => {
  try {
    const body = z.object({ bookingId: z.string(), token: z.string() }).parse(req.body);
    await cancelBooking(body.bookingId, body.token);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/b/:bookingId/reschedule', async (req, res) => {
  const token = z.string().parse(req.query.token);
  const booking = getBookingByToken(req.params.bookingId, token, 'reschedule');
  if (!booking) return res.status(404).send('Invalid link');
  const cfg = loadAvailabilityConfig();
  const date = String(req.query.date ?? dayjs().tz(cfg.timezone).format('YYYY-MM-DD'));
  const slots = await getSlotsForDate(date);
  res.render('reschedule', { booking, token, date, slots, timezone: cfg.timezone });
});

app.get('/b/:bookingId/cancel', (req, res) => {
  const token = z.string().parse(req.query.token);
  const booking = getBookingByToken(req.params.bookingId, token, 'cancel');
  if (!booking) return res.status(404).send('Invalid link');
  res.render('cancel', { booking, token });
});

app.get('/admin/setup', (_req, res) => {
  res.render('admin-setup');
});

app.post('/admin/setup', (req, res) => {
  const body = z.object({ username: z.string().min(3), password: z.string().min(8) }).parse(req.body);
  createAdmin(body.username, body.password);
  res.redirect('/admin/login');
});

app.get('/admin/login', (_req, res) => res.render('admin-login'));
app.post('/admin/login', (req, res) => {
  const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
  const sid = loginAdmin(body.username, body.password);
  if (!sid) return res.status(401).send('Login failed');
  res.cookie('admin_session', sid, { httpOnly: true, sameSite: 'lax' });
  res.redirect('/admin');
});

app.get('/admin', requireAdmin, (_req, res) => {
  res.render('admin', { authUrl: getAuthorizationUrl() });
});

app.get('/auth/callback', requireAdmin, async (req, res) => {
  try {
    const code = z.string().parse(req.query.code);
    await exchangeCodeForToken(code);
    res.send('Microsoft OAuth erfolgreich verbunden.');
  } catch (e: any) {
    res.status(400).send(e.message);
  }
});

app.listen(env.PORT, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'server_started', port: env.PORT }));
});
