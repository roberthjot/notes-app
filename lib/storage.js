const usePg = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);

const store = usePg ? require('./storage/pg') : require('./storage/fs');

module.exports = {
  store,
  usePg,
  init: store.init,
  getAll: store.getAll,
  getById: store.getById,
  insert: store.insert,
  update: store.update,
  remove: store.remove,
  getUser: store.getUser,
  createUser: store.createUser,
};