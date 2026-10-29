// Process-wide database handle. init() once at startup; everything else imports { run, get, all, transaction }.
const { createDb } = require('./connection');

let instance = null;
const need = () => {
  if (!instance) throw new Error('Database not initialised');
  return instance;
};

module.exports = {
  init: async (file) => {
    instance = await createDb(file);
    return instance;
  },
  run: (sql, params) => need().run(sql, params),
  get: (sql, params) => need().get(sql, params),
  all: (sql, params) => need().all(sql, params),
  transaction: (fn) => need().transaction(fn),
  get file() { return need().file; },
  close: async () => {
    if (instance) await instance.close();
    instance = null;
  }
};
