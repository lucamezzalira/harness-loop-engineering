function required(name) {
  const defaults = { BILLING_PORT: '3102', LOG_LEVEL: 'info' };
  const v = process.env[name] ?? defaults[name];
  if (v == null || v === '') throw new Error(`missing env ${name}`);
  return v;
}

export const env = {
  port: Number(required('BILLING_PORT')),
  logLevel: required('LOG_LEVEL'),
};
