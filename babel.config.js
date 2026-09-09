module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Drizzle ships its migrations as .sql files that we import from JS.
      // Without this, Metro hands the SQL to Babel and it dies on line 1.
      // Pairs with `config.resolver.sourceExts.push('sql')` in metro.config.js —
      // both halves are required.
      ['inline-import', { extensions: ['.sql'] }],
    ],
  };
};
