module.exports = {
  DECORATORS: {
    get: () => require.resolve('babel-plugin-transform-decorators-legacy'),
  },
  LODASH: {
    get: () => require.resolve('babel-plugin-lodash'),
  },
};
