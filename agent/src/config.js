export const config = {
  port: parseInt(process.env.PORT || '8080'),
  agentToken: process.env.AGENT_TOKEN,
  consoleSecret: process.env.CONSOLE_SECRET || process.env.AGENT_TOKEN,
  botDataDir: process.env.BOT_DATA_DIR || '/var/lib/raven/bots',
};
