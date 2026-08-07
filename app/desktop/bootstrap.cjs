(async () => {
  try {
    await import('./main.mjs');
  } catch (error) {
    console.error(error);
    const { app } = require('electron');
    if (app?.isReady()) app.exit(1);
    else app?.once('ready', () => app.exit(1));
    process.exitCode = 1;
  }
})();
