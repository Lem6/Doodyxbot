const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");
const dotenv = require("dotenv");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");
const fetch = require("node-fetch");

dotenv.config();

// ============== DATABASE SETUP ==============
const db = new Database("doodyx.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    welcome_channel TEXT,
    leave_channel TEXT,
    notif_channel TEXT,
    logs_channel TEXT,
    role_update_channel TEXT,
    welcome_message TEXT DEFAULT 'Bienvenue {user} ! 🎉 Tu as rejoint la team Doodyx ! On est content de t''avoir parmi nous ! 💜',
    leave_message TEXT DEFAULT 'Merci à {user} d''avoir rejoint la team, j''espère te revoir bientôt ! 👋',
    role_update_message TEXT DEFAULT 'GG à {user} d''avoir évolué en {role} ! 🎊🔥',
    antispam_enabled INTEGER DEFAULT 1,
    antiscam_enabled INTEGER DEFAULT 1,
    max_messages INTEGER DEFAULT 4,
    max_interval INTEGER DEFAULT 3000,
    timeout_duration INTEGER DEFAULT 300000,
    youtube_channel_id TEXT,
    youtube_notif_channel TEXT,
    twitch_username TEXT,
    twitch_notif_channel TEXT
  );

  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    user_id TEXT,
    moderator_id TEXT,
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS mod_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    action TEXT,
    user_id TEXT,
    moderator_id TEXT,
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notif_cache (
    guild_id TEXT,
    type TEXT,
    content_id TEXT,
    PRIMARY KEY (guild_id, type, content_id)
  );
`);

// ============== CLIENT SETUP ==============
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

client.db = db;
client.spamMap = new Map();
client.recentlyFlagged = new Map();
client.recentlyScammed = new Map();

// Nelson "HA-HA!" gif
const NELSON_SCAM_GIF = "https://media.tenor.com/9CFHdKlZk0oAAAAM/nelson-simpsons.gif";

// RSS + Fetch for notifications
const parser = new Parser();

// ============== HELPER FUNCTIONS ==============
function getGuildConfig(guildId) {
  let config = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId);
  if (!config) {
    db.prepare("INSERT OR IGNORE INTO guild_config (guild_id) VALUES (?)").run(guildId);
    config = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId);
  }
  return config;
}

function logAction(guildId, action, userId, moderatorId, reason) {
  db.prepare(
    "INSERT INTO mod_logs (guild_id, action, user_id, moderator_id, reason) VALUES (?, ?, ?, ?, ?)"
  ).run(guildId, action, userId, moderatorId, reason);
}

// ============== SCAM DETECTION ==============
const scamPatterns = [
  /free\s*nitro/i,
  /steam\s*community/i,
  /discord\s*gift/i,
  /claim\s*your\s*prize/i,
  /@everyone.*https?:\/\//i,
  /airdrop.*crypto/i,
  /bitcoin.*free/i,
  /ethereum.*claim/i,
  /metamask.*connect/i,
  /wallet.*connect/i,
  /nft.*free.*mint/i,
  /elon\s*musk.*giveaway/i,
  /mrbeast.*giveaway/i,
  /mr\s*beast.*gift/i,
  /mr\s*beast/i,
  /mrbeast/i,
  /click\s*here.*reward/i,
  /congratulations.*won/i,
  /you\s*have\s*been\s*selected/i,
  /verify.*link.*account/i,
  /suspicious.*login.*click/i,
  /account.*suspended.*verify/i,
  /recover.*account.*link/i,
  /hacked.*send.*crypto/i,
  /send\s*\d+\s*(btc|eth|sol)/i,
  /double\s*your\s*(crypto|bitcoin|ethereum)/i,
  /trading\s*bot.*guaranteed/i,
  /investment.*guaranteed.*return/i,
  /check\s*out.*onlyfans/i,
  /18\+.*link/i,
  /t\.me\/[a-zA-Z]/i,
  /bit\.ly/i,
  /tinyurl\.com/i,
  /rakeback/i,
  /promo\s*code.*bonus/i,
  /activate\s*code/i,
  /withdrawal\s*success/i,
  /casino.*bonus/i,
  /vpyro/i,
  /kickwin/i
];

function isScam(content) {
  let score = 0;
  for (const pattern of scamPatterns) {
    if (pattern.test(content)) score++;
  }
  return score >= 1;
}

function isSuspiciousLink(content) {
  const suspiciousDomains = [
    /discorc\.gift/i,
    /discrod\.com/i,
    /dlscord\.com/i,
    /disc0rd\.com/i,
    /steamcommunlty/i,
    /stearncommunit/i,
    /nitro-gift/i,
    /free-nitro/i,
    /discord-nitro/i,
    /hypesquad-event/i,
    /kickwin/i,
    /rakeback/i
  ];
  return suspiciousDomains.some((d) => d.test(content));
}

function detectSuspiciousAttachments(message) {
  if (message.attachments.size >= 2) return true;

  if (message.attachments.size > 0 && message.content.length === 0) {
    const member = message.guild.members.cache.get(message.author.id);
    const accountAge = Date.now() - message.author.createdTimestamp;
    const memberAge = Date.now() - (member?.joinedTimestamp || Date.now());
    if (accountAge < 2592000000 || memberAge < 604800000) return true;
  }

  return false;
}

// ============== SLASH COMMANDS ==============
const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("📋 Configurer Doodyx Bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("🎛️ Ouvrir le panneau de modération")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("config")
    .setDescription("⚙️ Configurer les salons et messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName("bienvenue").setDescription("Salon de bienvenue")
        .addChannelOption((opt) => opt.setName("salon").setDescription("Salon").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName("depart").setDescription("Salon de départ")
        .addChannelOption((opt) => opt.setName("salon").setDescription("Salon").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName("logs").setDescription("Salon de logs")
        .addChannelOption((opt) => opt.setName("salon").setDescription("Salon").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName("notifs").setDescription("Salon de notifications")
        .addChannelOption((opt) => opt.setName("salon").setDescription("Salon").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName("evolution").setDescription("Salon d'évolution")
        .addChannelOption((opt) => opt.setName("salon").setDescription("Salon").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName("message-bienvenue").setDescription("Message de bienvenue ({user})")
        .addStringOption((opt) => opt.setName("message").setDescription("Message").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName("message-depart").setDescription("Message de départ ({user})")
        .addStringOption((opt) => opt.setName("message").setDescription("Message").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName("message-evolution").setDescription("Message d'évolution ({user}, {role})")
        .addStringOption((opt) => opt.setName("message").setDescription("Message").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName("antispam-config").setDescription("Paramètres anti-spam")
        .addIntegerOption((opt) => opt.setName("messages").setDescription("Max messages").setRequired(true))
        .addIntegerOption((opt) => opt.setName("secondes").setDescription("Intervalle en secondes").setRequired(true))
    ),

  new SlashCommandBuilder().setName("ban").setDescription("🔨 Bannir un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) => opt.setName("membre").setDescription("Membre").setRequired(true))
    .addStringOption((opt) => opt.setName("raison").setDescription("Raison")),

  new SlashCommandBuilder().setName("kick").setDescription("👢 Expulser un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((opt) => opt.setName("membre").setDescription("Membre").setRequired(true))
    .addStringOption((opt) => opt.setName("raison").setDescription("Raison")),

  new SlashCommandBuilder().setName("timeout").setDescription("⏰ Timeout un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName("membre").setDescription("Membre").setRequired(true))
    .addIntegerOption((opt) => opt.setName("duree").setDescription("Minutes").setRequired(true))
    .addStringOption((opt) => opt.setName("raison").setDescription("Raison")),

  new SlashCommandBuilder().setName("warn").setDescription("⚠️ Avertir un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName("membre").setDescription("Membre").setRequired(true))
    .addStringOption((opt) => opt.setName("raison").setDescription("Raison").setRequired(true)),

  new SlashCommandBuilder().setName("warnings").setDescription("📜 Voir les warns")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName("membre").setDescription("Membre").setRequired(true)),

  new SlashCommandBuilder().setName("clear").setDescription("🧹 Supprimer messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((opt) => opt.setName("nombre").setDescription("1-100").setRequired(true)),

  new SlashCommandBuilder().setName("antispam").setDescription("🛡️ Anti-spam on/off")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((opt) => opt.setName("activer").setDescription("Activer").setRequired(true)),

  new SlashCommandBuilder().setName("antiscam").setDescription("🛡️ Anti-scam on/off")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((opt) => opt.setName("activer").setDescription("Activer").setRequired(true)),

  new SlashCommandBuilder().setName("aide").setDescription("❓ Afficher l'aide"),

  new SlashCommandBuilder().setName("userinfo").setDescription("👤 Infos membre")
    .addUserOption((opt) => opt.setName("membre").setDescription("Membre")),

  new SlashCommandBuilder().setName("serverinfo").setDescription("📊 Infos serveur"),

  new SlashCommandBuilder().setName("lock").setDescription("🔒 Verrouiller salon")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder().setName("unlock").setDescription("🔓 Déverrouiller salon")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder().setName("slowmode").setDescription("🐌 Slowmode")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((opt) => opt.setName("secondes").setDescription("0=off").setRequired(true)),

  new SlashCommandBuilder().setName("unban").setDescription("🔓 Débannir")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((opt) => opt.setName("id").setDescription("ID").setRequired(true)),

  new SlashCommandBuilder().setName("debug").setDescription("🔧 Debug les permissions du bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("youtube")
    .setDescription("📺 Configurer les notifications YouTube")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName("set").setDescription("Définir la chaîne YouTube")
        .addStringOption((opt) => opt.setName("channel_id").setDescription("ID de la chaîne YouTube (UCxxxxx)").setRequired(true))
        .addChannelOption((opt) => opt.setName("salon").setDescription("Salon Discord pour les notifs").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName("disable").setDescription("Désactiver les notifications YouTube")
    ),

  new SlashCommandBuilder()
    .setName("twitch")
    .setDescription("🟣 Configurer les notifications Twitch")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName("set").setDescription("Définir le streamer Twitch")
        .addStringOption((opt) => opt.setName("username").setDescription("Nom d'utilisateur Twitch").setRequired(true))
        .addChannelOption((opt) => opt.setName("salon").setDescription("Salon Discord pour les notifs").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName("disable").setDescription("Désactiver les notifications Twitch")
    )
];

// ============== READY EVENT ==============
client.once("ready", async () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║         🎮 DOODYX BOT 🎮             ║
  ║  Connecté: ${client.user.tag.padEnd(24)}║
  ║  Serveurs: ${String(client.guilds.cache.size).padEnd(24)}║
  ║  Membres:  ${String(client.users.cache.size).padEnd(24)}║
  ╚══════════════════════════════════════╝
  `);

  client.user.setPresence({
    activities: [{ name: "la team Doodyx 🎮", type: 3 }],
    status: "dnd"
  });

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  try {
    console.log("📡 Enregistrement des commandes slash...");
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands.map((c) => c.toJSON())
    });
    console.log("✅ Commandes slash enregistrées !");
  } catch (error) {
    console.error("❌ Erreur:", error);
  }

  // First notification check 30s after boot
  setTimeout(() => {
    console.log("🔄 First notification check...");
    checkYouTube();
    checkTwitch();
  }, 30000);

  // Then every 5 minutes
  setInterval(() => {
    console.log("🔄 Checking YouTube and Twitch notifications...");
    checkYouTube();
    checkTwitch();
  }, 5 * 60 * 1000);
});

// ============== MEMBER JOIN ==============
client.on("guildMemberAdd", async (member) => {
  const config = getGuildConfig(member.guild.id);
  if (!config?.welcome_channel) return;

  const channel = member.guild.channels.cache.get(config.welcome_channel);
  if (!channel) return;

  const message = config.welcome_message.replace(/{user}/g, `<@${member.id}>`);

  const embed = new EmbedBuilder()
    .setColor("#00FF88")
    .setTitle("🎉 Nouveau membre !")
    .setDescription(message)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: "👤 Membre", value: `${member.user.tag}`, inline: true },
      { name: "📅 Compte créé", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: "👥 Membres", value: `${member.guild.memberCount}`, inline: true }
    )
    .setFooter({ text: "Bienvenue dans la team ! 💜" })
    .setTimestamp();

  channel.send({ content: `<@${member.id}>`, embeds: [embed] });
});

// ============== MEMBER LEAVE ==============
client.on("guildMemberRemove", async (member) => {
  const config = getGuildConfig(member.guild.id);
  if (!config?.leave_channel) return;

  const channel = member.guild.channels.cache.get(config.leave_channel);
  if (!channel) return;

  const message = config.leave_message.replace(/{user}/g, member.user.tag);

  const embed = new EmbedBuilder()
    .setColor("#FF4444")
    .setTitle("👋 Un membre nous a quitté...")
    .setDescription(message)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: "👤 Membre", value: `${member.user.tag}`, inline: true },
      { name: "👥 Membres restants", value: `${member.guild.memberCount}`, inline: true }
    )
    .setFooter({ text: "À bientôt ! 💜" })
    .setTimestamp();

  channel.send({ embeds: [embed] });
});

// ============== ROLE UPDATE ==============
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const config = getGuildConfig(newMember.guild.id);
  if (!config?.role_update_channel) return;

  const channel = newMember.guild.channels.cache.get(config.role_update_channel);
  if (!channel) return;

  const addedRoles = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));

  if (addedRoles.size > 0) {
    addedRoles.forEach((role) => {
      if (role.name === "@everyone") return;

      const message = config.role_update_message
        .replace(/{user}/g, `<@${newMember.id}>`)
        .replace(/{role}/g, role.name);

      const embed = new EmbedBuilder()
        .setColor("#FFD700")
        .setTitle("🎊 Évolution de rôle !")
        .setDescription(message)
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: "👤 Membre", value: `${newMember.user.tag}`, inline: true },
          { name: "🏅 Nouveau rôle", value: `${role.name}`, inline: true }
        )
        .setFooter({ text: "Félicitations ! 🔥" })
        .setTimestamp();

      channel.send({ content: `<@${newMember.id}>`, embeds: [embed] });
    });
  }
});

// ============== MESSAGE CREATE (ANTISPAM + ANTISCAM) ==============
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const config = getGuildConfig(message.guild.id);

  console.log(`\n📩 [MSG] ${message.author.tag} in #${message.channel.name}: "${message.content.substring(0, 50)}" (${message.attachments.size} attachments)`);

  // ======= ANTI-SCAM =======
  if (config?.antiscam_enabled) {
    const content = message.content;
    const scamText = isScam(content);
    const suspiciousLink = isSuspiciousLink(content);
    const suspiciousAttach = detectSuspiciousAttachments(message);

    console.log(`[SCAM CHECK] text:${scamText} link:${suspiciousLink} attach:${suspiciousAttach}`);

    if (scamText || suspiciousLink || suspiciousAttach) {
      const scamKey = `${message.guild.id}-${message.author.id}`;
      const lastScam = client.recentlyScammed.get(scamKey) || 0;
      if (Date.now() - lastScam < 30000) {
        console.log(`[SCAM] ⏸️ ${message.author.tag} already flagged recently, deleting silently`);
        try { await message.delete(); } catch (e) {}
        return;
      }
      client.recentlyScammed.set(scamKey, Date.now());

      console.log(`🚨 [SCAM DETECTED] ${message.author.tag}`);

      const botMember = message.guild.members.me;
      const perms = message.channel.permissionsFor(botMember);
      console.log(`[SCAM] Bot ManageMessages: ${perms.has(PermissionFlagsBits.ManageMessages)}`);
      console.log(`[SCAM] Bot ModerateMembers: ${perms.has(PermissionFlagsBits.ModerateMembers)}`);

      try {
        try {
          await message.delete();
          console.log(`[SCAM] ✅ Message deleted`);
        } catch (e) {
          console.error(`[SCAM] ❌ DELETE ERROR: ${e.message}`);
        }

        const member = message.guild.members.cache.get(message.author.id);
        let timeoutSuccess = false;
        if (member) {
          if (member.moderatable) {
            try {
              await member.timeout(3600000, "🛡️ Anti-Scam Doodyx Bot");
              timeoutSuccess = true;
              console.log(`[SCAM] ✅ Timeout applied`);
            } catch (e) {
              console.error(`[SCAM] ❌ TIMEOUT ERROR: ${e.message}`);
            }
          } else {
            console.log(`[SCAM] ⚠️ Not moderatable (owner or higher role)`);
          }
        }

        const embed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle("🚨 IT'S A SCAM ! 🚨")
          .setDescription(
            `**⚠️ Le compte de ${message.author.tag} a possiblement été compromis !**\n\n` +
              `Le message contenait du contenu suspect (scam/phishing/crypto).\n\n` +
              (timeoutSuccess
                ? `**🔒 Action:** Timeout 1 heure + message supprimé.\n`
                : `**🔒 Action:** Message supprimé (timeout impossible).\n`) +
              `**💡 Conseil:** Change ton mot de passe Discord et active le 2FA !`
          )
          .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
          .setImage(NELSON_SCAM_GIF)
          .setFooter({ text: "Protection Anti-Scam 🛡️" })
          .setTimestamp();

        message.channel.send({ embeds: [embed] }).catch((e) => console.error("Embed send:", e.message));

        if (config.logs_channel) {
          const logChannel = message.guild.channels.cache.get(config.logs_channel);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setColor("#FF0000")
              .setTitle("🚨 Scam Détecté - Log")
              .addFields(
                { name: "Utilisateur", value: `${message.author.tag} (${message.author.id})`, inline: true },
                { name: "Salon", value: `${message.channel}`, inline: true },
                { name: "Contenu", value: content ? `||${content.substring(0, 500)}||` : "Aucun texte (images)" },
                { name: "Attachements", value: `${message.attachments.size} fichier(s)` }
              )
              .setTimestamp();
            logChannel.send({ embeds: [logEmbed] }).catch(() => {});
          }
        }

        logAction(message.guild.id, "ANTISCAM", message.author.id, client.user.id, "Scam détecté");
      } catch (err) {
        console.error("[SCAM] GLOBAL ERROR:", err);
      }
      return;
    }
  }

  // ======= ANTI-SPAM =======
  if (config?.antispam_enabled) {
    const member = message.guild.members.cache.get(message.author.id);
    if (member) {
      const key = `${message.guild.id}-${message.author.id}`;
      if (!client.spamMap.has(key)) {
        client.spamMap.set(key, []);
      }

      const timestamps = client.spamMap.get(key);
      timestamps.push(Date.now());

      const interval = config.max_interval || 3000;
      const filtered = timestamps.filter((t) => Date.now() - t < interval);
      client.spamMap.set(key, filtered);

      console.log(`[SPAM CHECK] ${message.author.tag}: ${filtered.length}/${config.max_messages} in ${interval}ms`);

      if (filtered.length >= (config.max_messages || 4)) {
        const flagKey = `${message.guild.id}-${message.author.id}`;
        const lastFlag = client.recentlyFlagged.get(flagKey) || 0;
        if (Date.now() - lastFlag < 30000) {
          console.log(`[SPAM] ⏸️ ${message.author.tag} already flagged recently, deleting silently`);
          try { await message.delete(); } catch (e) {}
          return;
        }
        client.recentlyFlagged.set(flagKey, Date.now());

        console.log(`🚨 [SPAM DETECTED] ${message.author.tag}`);

        const botMember = message.guild.members.me;
        const perms = message.channel.permissionsFor(botMember);
        console.log(`[SPAM] Bot ManageMessages: ${perms.has(PermissionFlagsBits.ManageMessages)}`);
        console.log(`[SPAM] Bot ModerateMembers: ${perms.has(PermissionFlagsBits.ModerateMembers)}`);

        try {
          try {
            const messages = await message.channel.messages.fetch({ limit: 100 });
            console.log(`[SPAM] Fetched ${messages.size} messages`);

            const now = Date.now();
            const userMessages = messages.filter(
              (m) => m.author.id === message.author.id && now - m.createdTimestamp < 60000
            );

            console.log(`[SPAM] Found ${userMessages.size} user messages to delete`);

            if (userMessages.size >= 2) {
              const deleted = await message.channel.bulkDelete(userMessages, true);
              console.log(`[SPAM] ✅ BulkDeleted ${deleted.size} messages`);
            } else if (userMessages.size === 1) {
              await userMessages.first().delete();
              console.log(`[SPAM] ✅ Deleted 1 message`);
            }
          } catch (e) {
            console.error(`[SPAM] ❌ DELETION ERROR: ${e.message}`);
          }

          let timeoutSuccess = false;
          if (member.moderatable) {
            try {
              await member.timeout(config.timeout_duration || 300000, "🛡️ Anti-Spam Doodyx Bot");
              timeoutSuccess = true;
              console.log(`[SPAM] ✅ Timeout applied`);
            } catch (e) {
              console.error(`[SPAM] ❌ TIMEOUT ERROR: ${e.message}`);
            }
          } else {
            console.log(`[SPAM] ⚠️ Not moderatable (owner or higher role)`);
          }

          const embed = new EmbedBuilder()
            .setColor("#FFA500")
            .setTitle("🛡️ Anti-Spam Détecté")
            .setDescription(
              timeoutSuccess
                ? `**${message.author.tag}** timeout pour spam.\n**Durée:** ${(config.timeout_duration || 300000) / 60000} min\n✅ Messages supprimés`
                : `⚠️ Spam de **${message.author.tag}** !\n✅ Messages supprimés\n❌ Timeout impossible (owner / perms)`
            )
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: "Protection Anti-Spam" })
            .setTimestamp();

          message.channel.send({ embeds: [embed] }).catch((e) => console.error("Embed send:", e.message));
          client.spamMap.set(key, []);

          logAction(
            message.guild.id,
            "ANTISPAM",
            message.author.id,
            client.user.id,
            timeoutSuccess ? "Timeout pour spam" : "Spam détecté"
          );
        } catch (err) {
          console.error("[SPAM] GLOBAL ERROR:", err);
        }
      }
    }
  }
});

// ============== INTERACTION HANDLER ==============
client.on("interactionCreate", async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ======= DEBUG =======
  if (commandName === "debug") {
    const botMember = interaction.guild.members.me;
    const perms = interaction.channel.permissionsFor(botMember);
    const userMember = interaction.member;

    const embed = new EmbedBuilder()
      .setColor("#00BFFF")
      .setTitle("🔧 Debug - Doodyx Bot")
      .addFields(
        { name: "🤖 Bot", value: `${botMember.user.tag}\nID: ${botMember.id}`, inline: false },
        {
          name: "🔑 Permissions Bot (ce salon)",
          value:
            `Administrator: ${perms.has(PermissionFlagsBits.Administrator) ? "✅" : "❌"}\n` +
            `Manage Messages: ${perms.has(PermissionFlagsBits.ManageMessages) ? "✅" : "❌"}\n` +
            `Moderate Members: ${perms.has(PermissionFlagsBits.ModerateMembers) ? "✅" : "❌"}\n` +
            `Kick Members: ${perms.has(PermissionFlagsBits.KickMembers) ? "✅" : "❌"}\n` +
            `Ban Members: ${perms.has(PermissionFlagsBits.BanMembers) ? "✅" : "❌"}`
        },
        {
          name: "📊 Hiérarchie",
          value:
            `Bot role position: **${botMember.roles.highest.position}** (${botMember.roles.highest.name})\n` +
            `Ta position: **${userMember.roles.highest.position}** (${userMember.roles.highest.name})\n` +
            `Serveur owner: <@${interaction.guild.ownerId}>`
        },
        {
          name: "⚙️ Config Anti-Spam",
          value: (() => {
            const c = getGuildConfig(interaction.guild.id);
            return `Anti-Spam: ${c.antispam_enabled ? "✅" : "❌"}\nAnti-Scam: ${c.antiscam_enabled ? "✅" : "❌"}\nMax messages: ${c.max_messages} en ${c.max_interval / 1000}s`;
          })()
        },
        {
          name: "📺 Notifications",
          value: (() => {
            const c = getGuildConfig(interaction.guild.id);
            return `YouTube: ${c.youtube_channel_id ? `\`${c.youtube_channel_id}\` → <#${c.youtube_notif_channel}>` : "❌"}\nTwitch: ${c.twitch_username ? `\`${c.twitch_username}\` → <#${c.twitch_notif_channel}>` : "❌"}`;
          })()
        },
        {
          name: "💡 Diagnostic",
          value:
            botMember.roles.highest.position <= userMember.roles.highest.position
              ? "⚠️ Le rôle du bot est **PLUS BAS** ou égal au tien ! Monte-le au-dessus dans les Rôles du serveur."
              : "✅ Hiérarchie OK, le bot peut te modérer (sauf si tu es owner)."
        }
      )
      .setFooter({ text: "Debug 🔧" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ======= SETUP =======
  if (commandName === "setup") {
    const embed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle("📋 Configuration de Doodyx Bot")
      .setDescription(
        "**Salons:**\n" +
          "`/config bienvenue` `/config depart` `/config logs`\n" +
          "`/config notifs` `/config evolution`\n\n" +
          "**Messages:**\n" +
          "`/config message-bienvenue` `/config message-depart`\n" +
          "`/config message-evolution`\n\n" +
          "**Variables:** `{user}`, `{role}`\n\n" +
          "**Protection:**\n" +
          "`/antispam` `/antiscam`\n" +
          "`/config antispam-config` - Régler le seuil\n\n" +
          "**Notifications:**\n" +
          "`/youtube set` - Notifs YouTube\n" +
          "`/twitch set` - Notifs Twitch\n\n" +
          "**Debug:**\n" +
          "`/debug` - Vérifier permissions du bot"
      )
      .setFooter({ text: "Setup 💜" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ======= PANEL =======
  if (commandName === "panel") {
    const config = getGuildConfig(interaction.guild.id);

    const embed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle("🎛️ Panneau de Modération Doodyx")
      .setDescription("Sélectionne une catégorie ci-dessous.")
      .addFields(
        {
          name: "📢 Salons configurés",
          value:
            `Bienvenue: ${config.welcome_channel ? `<#${config.welcome_channel}>` : "❌"}\n` +
            `Départ: ${config.leave_channel ? `<#${config.leave_channel}>` : "❌"}\n` +
            `Logs: ${config.logs_channel ? `<#${config.logs_channel}>` : "❌"}\n` +
            `Notifs: ${config.notif_channel ? `<#${config.notif_channel}>` : "❌"}\n` +
            `Évolution: ${config.role_update_channel ? `<#${config.role_update_channel}>` : "❌"}`
        },
        {
          name: "🛡️ Protection",
          value:
            `Anti-Spam: ${config.antispam_enabled ? "✅" : "❌"} (${config.max_messages} msg / ${config.max_interval / 1000}s)\n` +
            `Anti-Scam: ${config.antiscam_enabled ? "✅" : "❌"}`
        },
        {
          name: "📺 Notifications",
          value:
            `YouTube: ${config.youtube_channel_id ? "✅" : "❌"}\n` +
            `Twitch: ${config.twitch_username ? "✅" : "❌"}`
        }
      )
      .setFooter({ text: "Panel de Modération 💜" })
      .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("panel_select")
      .setPlaceholder("🔧 Choisir une action...")
      .addOptions([
        { label: "📢 Configurer les salons", description: "Bienvenue, départ, logs...", value: "config_channels", emoji: "📢" },
        { label: "✉️ Messages personnalisés", description: "Modifier les messages", value: "config_messages", emoji: "✉️" },
        { label: "🛡️ Anti-Spam", description: "Configurer l'anti-spam", value: "config_antispam", emoji: "🛡️" },
        { label: "🚨 Anti-Scam", description: "Configurer l'anti-scam", value: "config_antiscam", emoji: "🚨" },
        { label: "📺 Notifications", description: "YouTube & Twitch", value: "config_notifs", emoji: "📺" },
        { label: "📊 Statistiques", description: "Stats de modération", value: "stats", emoji: "📊" }
      ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  // ======= CONFIG =======
  if (commandName === "config") {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === "bienvenue") {
      const channel = interaction.options.getChannel("salon");
      db.prepare("UPDATE guild_config SET welcome_channel = ? WHERE guild_id = ?").run(channel.id, guildId);
      await interaction.reply({ content: `✅ Salon de bienvenue: ${channel}`, ephemeral: true });
    } else if (sub === "depart") {
      const channel = interaction.options.getChannel("salon");
      db.prepare("UPDATE guild_config SET leave_channel = ? WHERE guild_id = ?").run(channel.id, guildId);
      await interaction.reply({ content: `✅ Salon de départ: ${channel}`, ephemeral: true });
    } else if (sub === "logs") {
      const channel = interaction.options.getChannel("salon");
      db.prepare("UPDATE guild_config SET logs_channel = ? WHERE guild_id = ?").run(channel.id, guildId);
      await interaction.reply({ content: `✅ Salon de logs: ${channel}`, ephemeral: true });
    } else if (sub === "notifs") {
      const channel = interaction.options.getChannel("salon");
      db.prepare("UPDATE guild_config SET notif_channel = ? WHERE guild_id = ?").run(channel.id, guildId);
      await interaction.reply({ content: `✅ Salon de notifs: ${channel}`, ephemeral: true });
    } else if (sub === "evolution") {
      const channel = interaction.options.getChannel("salon");
      db.prepare("UPDATE guild_config SET role_update_channel = ? WHERE guild_id = ?").run(channel.id, guildId);
      await interaction.reply({ content: `✅ Salon d'évolution: ${channel}`, ephemeral: true });
    } else if (sub === "message-bienvenue") {
      const msg = interaction.options.getString("message");
      db.prepare("UPDATE guild_config SET welcome_message = ? WHERE guild_id = ?").run(msg, guildId);
      await interaction.reply({
        content: `✅ Message mis à jour !\n**Aperçu:** ${msg.replace(/{user}/g, interaction.user.tag)}`,
        ephemeral: true
      });
    } else if (sub === "message-depart") {
      const msg = interaction.options.getString("message");
      db.prepare("UPDATE guild_config SET leave_message = ? WHERE guild_id = ?").run(msg, guildId);
      await interaction.reply({
        content: `✅ Message mis à jour !\n**Aperçu:** ${msg.replace(/{user}/g, interaction.user.tag)}`,
        ephemeral: true
      });
    } else if (sub === "message-evolution") {
      const msg = interaction.options.getString("message");
      db.prepare("UPDATE guild_config SET role_update_message = ? WHERE guild_id = ?").run(msg, guildId);
      await interaction.reply({
        content: `✅ Message mis à jour !\n**Aperçu:** ${msg.replace(/{user}/g, interaction.user.tag).replace(/{role}/g, "Modérateur")}`,
        ephemeral: true
      });
    } else if (sub === "antispam-config") {
      const messages = interaction.options.getInteger("messages");
      const secondes = interaction.options.getInteger("secondes");
      db.prepare("UPDATE guild_config SET max_messages = ?, max_interval = ? WHERE guild_id = ?").run(
        messages,
        secondes * 1000,
        guildId
      );
      await interaction.reply({
        content: `✅ Anti-spam configuré: **${messages} messages en ${secondes}s**`,
        ephemeral: true
      });
    }
  }

  // ======= YOUTUBE =======
  if (commandName === "youtube") {
    const sub = interaction.options.getSubcommand();

    if (sub === "set") {
      const channelId = interaction.options.getString("channel_id");
      const salon = interaction.options.getChannel("salon");

      if (!channelId.startsWith("UC") || channelId.length < 20) {
        return interaction.reply({
          content: "❌ ID YouTube invalide ! Il doit commencer par `UC` (exemple: `UCX6OQ3DkcsbYNE6H8uQQuVA`).\n\n**Comment le trouver :**\n1. Va sur la chaîne YouTube\n2. Regarde l'URL: `youtube.com/channel/UCxxxxx`\n3. Ou utilise https://commentpicker.com/youtube-channel-id.php",
          ephemeral: true
        });
      }

      db.prepare("UPDATE guild_config SET youtube_channel_id = ?, youtube_notif_channel = ? WHERE guild_id = ?")
        .run(channelId, salon.id, interaction.guild.id);

      await interaction.reply({
        content: `✅ Notifications YouTube configurées !\n📺 Chaîne: \`${channelId}\`\n📢 Salon: ${salon}\n\nVérification toutes les 5 minutes.`,
        ephemeral: true
      });
    } else if (sub === "disable") {
      db.prepare("UPDATE guild_config SET youtube_channel_id = NULL, youtube_notif_channel = NULL WHERE guild_id = ?")
        .run(interaction.guild.id);
      await interaction.reply({ content: "✅ Notifications YouTube désactivées.", ephemeral: true });
    }
  }

  // ======= TWITCH =======
  if (commandName === "twitch") {
    const sub = interaction.options.getSubcommand();

    if (sub === "set") {
      const username = interaction.options.getString("username").toLowerCase();
      const salon = interaction.options.getChannel("salon");

      db.prepare("UPDATE guild_config SET twitch_username = ?, twitch_notif_channel = ? WHERE guild_id = ?")
        .run(username, salon.id, interaction.guild.id);

      await interaction.reply({
        content: `✅ Notifications Twitch configurées !\n🟣 Streamer: \`${username}\`\n📢 Salon: ${salon}\n\nVérification toutes les 5 minutes.`,
        ephemeral: true
      });
    } else if (sub === "disable") {
      db.prepare("UPDATE guild_config SET twitch_username = NULL, twitch_notif_channel = NULL WHERE guild_id = ?")
        .run(interaction.guild.id);
      await interaction.reply({ content: "✅ Notifications Twitch désactivées.", ephemeral: true });
    }
  }

  // ======= BAN =======
  if (commandName === "ban") {
    const user = interaction.options.getUser("membre");
    const reason = interaction.options.getString("raison") || "Aucune raison";
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) return interaction.reply({ content: "❌ Membre introuvable !", ephemeral: true });
    if (!member.bannable) return interaction.reply({ content: "❌ Impossible de bannir !", ephemeral: true });

    try {
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle("🔨 Tu as été banni")
          .setDescription(`De **${interaction.guild.name}**\n**Raison:** ${reason}`)
          .setTimestamp();
        await user.send({ embeds: [dmEmbed] });
      } catch (e) {}

      await member.ban({ reason });

      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("🔨 Membre Banni")
        .addFields(
          { name: "👤 Membre", value: `${user.tag}`, inline: true },
          { name: "👮 Modérateur", value: `${interaction.user.tag}`, inline: true },
          { name: "📝 Raison", value: reason }
        )
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: "Modération 🔨" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(interaction.guild.id, "BAN", user.id, interaction.user.id, reason);
    } catch (err) {
      await interaction.reply({ content: "❌ Erreur !", ephemeral: true });
    }
  }

  // ======= KICK =======
  if (commandName === "kick") {
    const user = interaction.options.getUser("membre");
    const reason = interaction.options.getString("raison") || "Aucune raison";
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) return interaction.reply({ content: "❌ Membre introuvable !", ephemeral: true });
    if (!member.kickable) return interaction.reply({ content: "❌ Impossible d'expulser !", ephemeral: true });

    try {
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor("#FFA500")
          .setTitle("👢 Tu as été expulsé")
          .setDescription(`De **${interaction.guild.name}**\n**Raison:** ${reason}`)
          .setTimestamp();
        await user.send({ embeds: [dmEmbed] });
      } catch (e) {}

      await member.kick(reason);

      const embed = new EmbedBuilder()
        .setColor("#FFA500")
        .setTitle("👢 Membre Expulsé")
        .addFields(
          { name: "👤 Membre", value: `${user.tag}`, inline: true },
          { name: "👮 Modérateur", value: `${interaction.user.tag}`, inline: true },
          { name: "📝 Raison", value: reason }
        )
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: "Modération 👢" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(interaction.guild.id, "KICK", user.id, interaction.user.id, reason);
    } catch (err) {
      await interaction.reply({ content: "❌ Erreur !", ephemeral: true });
    }
  }

  // ======= TIMEOUT =======
  if (commandName === "timeout") {
    const user = interaction.options.getUser("membre");
    const duration = interaction.options.getInteger("duree");
    const reason = interaction.options.getString("raison") || "Aucune raison";
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) return interaction.reply({ content: "❌ Membre introuvable !", ephemeral: true });
    if (!member.moderatable) return interaction.reply({ content: "❌ Impossible !", ephemeral: true });

    try {
      await member.timeout(duration * 60000, reason);

      const embed = new EmbedBuilder()
        .setColor("#FFAA00")
        .setTitle("⏰ Membre en Timeout")
        .addFields(
          { name: "👤 Membre", value: `${user.tag}`, inline: true },
          { name: "👮 Modérateur", value: `${interaction.user.tag}`, inline: true },
          { name: "⏱️ Durée", value: `${duration} min`, inline: true },
          { name: "📝 Raison", value: reason }
        )
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: "Modération ⏰" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(interaction.guild.id, "TIMEOUT", user.id, interaction.user.id, `${duration}min - ${reason}`);
    } catch (err) {
      await interaction.reply({ content: "❌ Erreur !", ephemeral: true });
    }
  }

  // ======= WARN =======
  if (commandName === "warn") {
    const user = interaction.options.getUser("membre");
    const reason = interaction.options.getString("raison");

    db.prepare("INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)").run(
      interaction.guild.id,
      user.id,
      interaction.user.id,
      reason
    );

    const warnCount = db
      .prepare("SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND user_id = ?")
      .get(interaction.guild.id, user.id).count;

    const embed = new EmbedBuilder()
      .setColor("#FFFF00")
      .setTitle("⚠️ Avertissement")
      .addFields(
        { name: "👤 Membre", value: `${user.tag}`, inline: true },
        { name: "👮 Modérateur", value: `${interaction.user.tag}`, inline: true },
        { name: "📊 Total warns", value: `${warnCount}`, inline: true },
        { name: "📝 Raison", value: reason }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: "Avertissement ⚠️" })
      .setTimestamp();

    let autoAction = "";
    const member = interaction.guild.members.cache.get(user.id);
    if (warnCount >= 5 && member?.bannable) {
      await member.ban({ reason: "5 avertissements atteints" });
      autoAction = "\n\n🔨 **Auto-ban:** 5 warns atteints !";
    } else if (warnCount >= 3 && member?.moderatable) {
      await member.timeout(3600000, "3 avertissements atteints");
      autoAction = "\n\n⏰ **Auto-timeout (1h):** 3 warns atteints !";
    }

    if (autoAction) embed.setDescription(autoAction);

    await interaction.reply({ embeds: [embed] });
    logAction(interaction.guild.id, "WARN", user.id, interaction.user.id, reason);
  }

  // ======= WARNINGS =======
  if (commandName === "warnings") {
    const user = interaction.options.getUser("membre");
    const warns = db
      .prepare("SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 10")
      .all(interaction.guild.id, user.id);

    if (warns.length === 0) {
      return interaction.reply({ content: `✅ ${user.tag} n'a aucun warn !`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor("#FFFF00")
      .setTitle(`📜 Avertissements de ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setDescription(
        warns.map((w, i) => `**${i + 1}.** ${w.reason}\n└ Par <@${w.moderator_id}> • ${w.timestamp}`).join("\n\n")
      )
      .setFooter({ text: `Total: ${warns.length} warn(s)` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ======= CLEAR =======
  if (commandName === "clear") {
    const amount = interaction.options.getInteger("nombre");
    if (amount < 1 || amount > 100) {
      return interaction.reply({ content: "❌ Nombre entre 1 et 100 !", ephemeral: true });
    }

    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);

      const embed = new EmbedBuilder()
        .setColor("#00BFFF")
        .setTitle("🧹 Messages Supprimés")
        .setDescription(`**${deleted.size}** messages supprimés par ${interaction.user.tag}`)
        .setFooter({ text: "Nettoyage 🧹" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      logAction(interaction.guild.id, "CLEAR", interaction.user.id, interaction.user.id, `${deleted.size} messages`);
    } catch (err) {
      await interaction.reply({
        content: "❌ Erreur ! Messages > 14 jours non supprimables en masse.",
        ephemeral: true
      });
    }
  }

  // ======= ANTISPAM =======
  if (commandName === "antispam") {
    const enabled = interaction.options.getBoolean("activer");
    db.prepare("UPDATE guild_config SET antispam_enabled = ? WHERE guild_id = ?").run(
      enabled ? 1 : 0,
      interaction.guild.id
    );
    await interaction.reply({
      content: `✅ Anti-spam ${enabled ? "**activé** 🛡️" : "**désactivé** ❌"}`,
      ephemeral: true
    });
  }

  // ======= ANTISCAM =======
  if (commandName === "antiscam") {
    const enabled = interaction.options.getBoolean("activer");
    db.prepare("UPDATE guild_config SET antiscam_enabled = ? WHERE guild_id = ?").run(
      enabled ? 1 : 0,
      interaction.guild.id
    );
    await interaction.reply({
      content: `✅ Anti-scam ${enabled ? "**activé** 🚨" : "**désactivé** ❌"}`,
      ephemeral: true
    });
  }

  // ======= AIDE =======
  if (commandName === "aide") {
    const embed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle("❓ Aide - Doodyx Bot")
      .setDescription("Toutes les commandes disponibles :")
      .addFields(
        { name: "⚙️ Configuration", value: "`/setup` `/panel` `/config` `/debug`" },
        { name: "🔨 Modération", value: "`/ban` `/kick` `/timeout` `/warn` `/warnings` `/clear` `/unban`" },
        { name: "🔧 Outils", value: "`/lock` `/unlock` `/slowmode` `/userinfo` `/serverinfo`" },
        { name: "📺 Notifications", value: "`/youtube set` `/youtube disable`\n`/twitch set` `/twitch disable`" },
        {
          name: "🛡️ Protection",
          value:
            "`/antispam` `/antiscam`\n\n🔒 Détecte automatiquement :\n• Faux Discord Nitro\n• Arnaques crypto/MrBeast/casino\n• Comptes hackés\n• Liens phishing\n• Images scam multiples"
        }
      )
      .setFooter({ text: "Doodyx Bot 💜" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // ======= USERINFO =======
  if (commandName === "userinfo") {
    const user = interaction.options.getUser("membre") || interaction.user;
    const member = interaction.guild.members.cache.get(user.id);

    const embed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle(`👤 Infos de ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: "🏷️ Tag", value: user.tag, inline: true },
        { name: "🆔 ID", value: user.id, inline: true },
        { name: "📅 Compte créé", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: "📥 A rejoint", value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "N/A", inline: true },
        {
          name: "🏅 Rôles",
          value: member
            ? member.roles.cache.filter((r) => r.name !== "@everyone").map((r) => r).join(", ") || "Aucun"
            : "N/A"
        }
      )
      .setFooter({ text: "Doodyx Bot 💜" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // ======= SERVERINFO =======
  if (commandName === "serverinfo") {
    const guild = interaction.guild;

    const embed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle(`📊 Infos de ${guild.name}`)
      .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: "🆔 ID", value: guild.id, inline: true },
        { name: "👑 Propriétaire", value: `<@${guild.ownerId}>`, inline: true },
        { name: "👥 Membres", value: `${guild.memberCount}`, inline: true },
        { name: "💬 Salons", value: `${guild.channels.cache.size}`, inline: true },
        { name: "🏅 Rôles", value: `${guild.roles.cache.size}`, inline: true },
        { name: "😀 Emojis", value: `${guild.emojis.cache.size}`, inline: true },
        { name: "📅 Créé le", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
      )
      .setFooter({ text: "Doodyx Bot 💜" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // ======= LOCK =======
  if (commandName === "lock") {
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });

      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("🔒 Salon Verrouillé")
        .setDescription(`Verrouillé par ${interaction.user.tag}`)
        .setFooter({ text: "🔒" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(interaction.guild.id, "LOCK", interaction.channel.id, interaction.user.id, "Verrouillé");
    } catch (err) {
      await interaction.reply({ content: "❌ Erreur !", ephemeral: true });
    }
  }

  // ======= UNLOCK =======
  if (commandName === "unlock") {
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: true });

      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("🔓 Salon Déverrouillé")
        .setDescription(`Déverrouillé par ${interaction.user.tag}`)
        .setFooter({ text: "🔓" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(interaction.guild.id, "UNLOCK", interaction.channel.id, interaction.user.id, "Déverrouillé");
    } catch (err) {
      await interaction.reply({ content: "❌ Erreur !", ephemeral: true });
    }
  }

  // ======= SLOWMODE =======
  if (commandName === "slowmode") {
    const seconds = interaction.options.getInteger("secondes");
    try {
      await interaction.channel.setRateLimitPerUser(seconds);

      const embed = new EmbedBuilder()
        .setColor("#00BFFF")
        .setTitle("🐌 Slowmode")
        .setDescription(seconds === 0 ? "Slowmode **désactivé**." : `Slowmode: **${seconds}s**`)
        .setFooter({ text: "🐌" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      await interaction.reply({ content: "❌ Erreur !", ephemeral: true });
    }
  }

  // ======= UNBAN =======
  if (commandName === "unban") {
    const userId = interaction.options.getString("id");
    try {
      await interaction.guild.bans.remove(userId);

      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("🔓 Utilisateur Débanni")
        .setDescription(`<@${userId}> a été débanni.`)
        .setFooter({ text: "🔓" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(interaction.guild.id, "UNBAN", userId, interaction.user.id, "Débanni");
    } catch (err) {
      await interaction.reply({ content: "❌ Utilisateur introuvable !", ephemeral: true });
    }
  }
});

// ============== SELECT MENU HANDLER ==============
async function handleSelectMenu(interaction) {
  if (interaction.customId === "panel_select") {
    const value = interaction.values[0];
    const config = getGuildConfig(interaction.guild.id);

    if (value === "config_channels") {
      const embed = new EmbedBuilder()
        .setColor("#FF6B6B")
        .setTitle("📢 Configuration des Salons")
        .setDescription(
          "`/config bienvenue #salon`\n" +
            "`/config depart #salon`\n" +
            "`/config logs #salon`\n" +
            "`/config notifs #salon`\n" +
            "`/config evolution #salon`"
        )
        .setFooter({ text: "💜" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (value === "config_messages") {
      const embed = new EmbedBuilder()
        .setColor("#FF6B6B")
        .setTitle("✉️ Messages Personnalisés")
        .setDescription(
          "**Messages actuels :**\n\n" +
            `**Bienvenue:** ${config.welcome_message}\n\n` +
            `**Départ:** ${config.leave_message}\n\n` +
            `**Évolution:** ${config.role_update_message}\n\n` +
            "**Modifier :**\n" +
            "`/config message-bienvenue [message]`\n" +
            "`/config message-depart [message]`\n" +
            "`/config message-evolution [message]`\n\n" +
            "**Variables :** `{user}`, `{role}`"
        )
        .setFooter({ text: "💜" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (value === "config_antispam") {
      const embed = new EmbedBuilder()
        .setColor("#FF6B6B")
        .setTitle("🛡️ Anti-Spam")
        .setDescription(
          `**Statut:** ${config.antispam_enabled ? "✅ Activé" : "❌ Désactivé"}\n` +
            `**Max messages:** ${config.max_messages} en ${config.max_interval / 1000}s\n` +
            `**Timeout:** ${config.timeout_duration / 60000} min\n\n` +
            "**Commandes:**\n" +
            "`/antispam activer:true/false`\n" +
            "`/config antispam-config messages:X secondes:Y`"
        )
        .setFooter({ text: "💜" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (value === "config_antiscam") {
      const embed = new EmbedBuilder()
        .setColor("#FF6B6B")
        .setTitle("🚨 Anti-Scam / Anti-Hack")
        .setDescription(
          `**Statut:** ${config.antiscam_enabled ? "✅ Activé" : "❌ Désactivé"}\n\n` +
            "**Détecte automatiquement :**\n" +
            "• 🎮 Faux Discord Nitro\n" +
            "• 💰 Arnaques Crypto\n" +
            "• 🎬 Faux MrBeast\n" +
            "• 🎰 Casino scams\n" +
            "• 🔓 Comptes hackés\n" +
            "• 🔗 Liens phishing\n" +
            "• 🖼️ Images scam multiples\n\n" +
            "**Action:** Suppression + Timeout 1h"
        )
        .setFooter({ text: "💜" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (value === "config_notifs") {
      const embed = new EmbedBuilder()
        .setColor("#FF6B6B")
        .setTitle("📺 Notifications YouTube & Twitch")
        .setDescription(
          `**📺 YouTube:**\n` +
            (config.youtube_channel_id
              ? `✅ Configuré: \`${config.youtube_channel_id}\` → <#${config.youtube_notif_channel}>`
              : "❌ Non configuré") +
            `\n\n**🟣 Twitch:**\n` +
            (config.twitch_username
              ? `✅ Configuré: \`${config.twitch_username}\` → <#${config.twitch_notif_channel}>`
              : "❌ Non configuré") +
            `\n\n**Commandes:**\n` +
            "`/youtube set channel_id:UCxxxxx salon:#notifs`\n" +
            "`/youtube disable`\n" +
            "`/twitch set username:kaicenat salon:#notifs`\n" +
            "`/twitch disable`\n\n" +
            "**💡 ID YouTube:** URL youtube.com/channel/**UCxxxxx**\nSi c'est `@username`, utilise https://commentpicker.com/youtube-channel-id.php"
        )
        .setFooter({ text: "💜" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (value === "stats") {
      const totalWarns = db
        .prepare("SELECT COUNT(*) as count FROM warnings WHERE guild_id = ?")
        .get(interaction.guild.id).count;
      const totalActions = db
        .prepare("SELECT COUNT(*) as count FROM mod_logs WHERE guild_id = ?")
        .get(interaction.guild.id).count;
      const recentActions = db
        .prepare("SELECT * FROM mod_logs WHERE guild_id = ? ORDER BY timestamp DESC LIMIT 5")
        .all(interaction.guild.id);

      const embed = new EmbedBuilder()
        .setColor("#FF6B6B")
        .setTitle("📊 Statistiques de Modération")
        .addFields(
          { name: "⚠️ Total Warns", value: `${totalWarns}`, inline: true },
          { name: "📋 Total Actions", value: `${totalActions}`, inline: true },
          { name: "👥 Membres", value: `${interaction.guild.memberCount}`, inline: true },
          {
            name: "📜 Actions Récentes",
            value:
              recentActions.length > 0
                ? recentActions.map((a) => `**${a.action}** - <@${a.user_id}> par <@${a.moderator_id}>`).join("\n")
                : "Aucune action"
          }
        )
        .setFooter({ text: "💜" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}

// ============== YOUTUBE + TWITCH NOTIFICATIONS ==============
async function checkYouTube() {
  const configs = db.prepare("SELECT * FROM guild_config WHERE youtube_channel_id IS NOT NULL AND youtube_notif_channel IS NOT NULL").all();

  for (const config of configs) {
    try {
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${config.youtube_channel_id}`;
      const feed = await parser.parseURL(feedUrl);

      if (!feed.items || feed.items.length === 0) continue;

      const latestVideo = feed.items[0];
      const videoId = latestVideo.id.replace("yt:video:", "");

      const alreadyNotified = db.prepare("SELECT * FROM notif_cache WHERE guild_id = ? AND type = ? AND content_id = ?")
        .get(config.guild_id, "youtube", videoId);

      if (alreadyNotified) continue;

      db.prepare("INSERT OR IGNORE INTO notif_cache (guild_id, type, content_id) VALUES (?, ?, ?)")
        .run(config.guild_id, "youtube", videoId);

      const videoDate = new Date(latestVideo.pubDate).getTime();
      if (Date.now() - videoDate > 3600000) continue;

      const guild = client.guilds.cache.get(config.guild_id);
      if (!guild) continue;

      const channel = guild.channels.cache.get(config.youtube_notif_channel);
      if (!channel) continue;

      const isShort = latestVideo.title.toLowerCase().includes("#shorts") ||
                       latestVideo.link.includes("/shorts/");

      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(`${isShort ? "🎬 NOUVEAU SHORT !" : "📺 NOUVELLE VIDÉO !"}`)
        .setDescription(`**${latestVideo.title}**\n\nPar **${feed.title}**`)
        .setURL(latestVideo.link)
        .setImage(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`)
        .addFields(
          { name: "🔗 Lien", value: `[Regarder la vidéo](${latestVideo.link})`, inline: true },
          { name: "📅 Publié", value: `<t:${Math.floor(videoDate / 1000)}:R>`, inline: true }
        )
        .setFooter({ text: "YouTube Notification 📺" })
        .setTimestamp();

      channel.send({ content: `📢 @everyone Nouvelle vidéo de **${feed.title}** !`, embeds: [embed] })
        .catch(err => console.error("YouTube send error:", err.message));

      console.log(`[YOUTUBE] ✅ Notified ${feed.title} - ${latestVideo.title}`);
    } catch (err) {
      console.error(`[YOUTUBE] Error checking ${config.youtube_channel_id}:`, err.message);
    }
  }
}

async function checkTwitch() {
  const configs = db.prepare(
    "SELECT * FROM guild_config WHERE twitch_username IS NOT NULL AND twitch_notif_channel IS NOT NULL"
  ).all();

  for (const config of configs) {
    try {
      const res = await fetch(`https://decapi.me/twitch/uptime/${config.twitch_username}`, {
        headers: {
          "User-Agent": "DoodxyBot/1.0"
        }
      });

      // Vérifier le status HTTP d'abord
      if (!res.ok) {
        console.warn(`[TWITCH] HTTP ${res.status} pour ${config.twitch_username}, skip.`);
        continue;
      }

      const contentType = res.headers.get("content-type") || "";
      
      // Si c'est du HTML = rate limit ou erreur serveur
      if (contentType.includes("text/html")) {
        console.warn(`[TWITCH] Reçu HTML (rate limit?) pour ${config.twitch_username}, skip.`);
        continue;
      }

      const uptime = (await res.text()).trim();
      console.log(`[TWITCH] Uptime response for ${config.twitch_username}: "${uptime}"`);

      const isLive = uptime.length > 0 &&
                     !uptime.toLowerCase().includes("offline") &&
                     !uptime.toLowerCase().includes("not found") &&
                     !uptime.toLowerCase().includes("error") &&
                     !uptime.startsWith("<"); // sécurité anti-HTML

      if (!isLive) {
        // Reset le cache quand offline
        db.prepare(
          "DELETE FROM notif_cache WHERE guild_id = ? AND type = ? AND content_id = ?"
        ).run(config.guild_id, "twitch", config.twitch_username);
        console.log(`[TWITCH] ${config.twitch_username} is offline.`);
        continue;
      }

      // Déjà notifié ?
      const alreadyNotified = db.prepare(
        "SELECT * FROM notif_cache WHERE guild_id = ? AND type = ? AND content_id = ?"
      ).get(config.guild_id, "twitch", config.twitch_username);

      if (alreadyNotified) {
        console.log(`[TWITCH] ${config.twitch_username} already notified.`);
        continue;
      }

      // Enregistrer dans le cache
      db.prepare(
        "INSERT OR IGNORE INTO notif_cache (guild_id, type, content_id) VALUES (?, ?, ?)"
      ).run(config.guild_id, "twitch", config.twitch_username);

      // Récupérer titre et jeu avec délai pour éviter le rate limit
      await new Promise(r => setTimeout(r, 1000));

      let title = "Stream en cours";
      let game = "Inconnu";

      try {
        const titleRes = await fetch(
          `https://decapi.me/twitch/title/${config.twitch_username}`,
          { headers: { "User-Agent": "DoodxyBot/1.0" } }
        );
        if (titleRes.ok) {
          const titleText = (await titleRes.text()).trim();
          if (!titleText.startsWith("<")) title = titleText;
        }
      } catch (e) {
        console.warn("[TWITCH] Impossible de récupérer le titre.");
      }

      await new Promise(r => setTimeout(r, 1000));

      try {
        const gameRes = await fetch(
          `https://decapi.me/twitch/game/${config.twitch_username}`,
          { headers: { "User-Agent": "DoodxyBot/1.0" } }
        );
        if (gameRes.ok) {
          const gameText = (await gameRes.text()).trim();
          if (!gameText.startsWith("<")) game = gameText;
        }
      } catch (e) {
        console.warn("[TWITCH] Impossible de récupérer le jeu.");
      }

      const guild = client.guilds.cache.get(config.guild_id);
      if (!guild) continue;

      const channel = guild.channels.cache.get(config.twitch_notif_channel);
      if (!channel) continue;

      const embed = new EmbedBuilder()
        .setColor("#9146FF")
        .setTitle(`🔴 ${config.twitch_username} est EN LIVE !`)
        .setDescription(`**${title}**`)
        .setURL(`https://twitch.tv/${config.twitch_username}`)
        .addFields(
          { name: "🎮 Jeu", value: game, inline: true },
          { name: "⏰ Depuis", value: uptime, inline: true },
          {
            name: "🔗 Lien",
            value: `[Rejoindre le stream](https://twitch.tv/${config.twitch_username})`,
            inline: false
          }
        )
        .setImage(
          `https://static-cdn.jtvnw.net/previews-ttv/live_user_${config.twitch_username}-1920x1080.jpg?rand=${Date.now()}`
        )
        .setFooter({ text: "Twitch Notification 🟣" })
        .setTimestamp();

      await channel.send({
        content: `📢 @everyone **${config.twitch_username}** est en live sur Twitch !`,
        embeds: [embed]
      }).catch(err => console.error("Twitch send error:", err.message));

      console.log(`[TWITCH] ✅ Notifié : ${config.twitch_username} est live`);

    } catch (err) {
      console.error(`[TWITCH] Erreur pour ${config.twitch_username}:`, err.message);
    }
  }
}

// ============== LOGIN ==============
client.login(process.env.TOKEN);
