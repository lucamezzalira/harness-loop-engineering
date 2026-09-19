/**
 * Single allowlisted env module for the orders service.
 */
function required(name) {
  const v = process.env[name];
  if (v == null || v === '') {
    // default for example estate
    if (name === 'ORDERS_PORT') return '3101';
    if (name === 'LOG_LEVEL') return 'info';
  }
  if (v == null || v === '') throw new Error(`missing env ${name}`);
  return v;
}

export const env = {
  port: Number(required('ORDERS_PORT')),
  logLevel: required('LOG_LEVEL'),
};
