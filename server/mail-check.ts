import { config } from './config.js';

const { mailConfig } = config();
const missing = [
  ['SMTP_HOST', mailConfig.host], ['SMTP_USER', mailConfig.user],
  ['SMTP_PASSWORD', mailConfig.password], ['MAIL_FROM', mailConfig.from],
  ['MAIL_ALLOWED_RECIPIENTS', mailConfig.allowedRecipients.length > 0],
].filter(([, value]) => !value).map(([name]) => name);
console.log(JSON.stringify({ mode: mailConfig.mode, configured: missing.length === 0, missing, deliveryVerified: false }));
