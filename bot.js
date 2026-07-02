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
    max_messages INTEGER DEFAULT 5,
    max_interval INTEGER DEFAULT 5000,
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

// ============== HELPER FUNCTIONS ==============
function getGuildConfig(guildId) {
  let config = db
    .prepare("SELECT * FROM guild_config WHERE guild_id = ?")
    .get(guildId);
  if (!config) {
    db.prepare("INSERT OR IGNORE INTO guild_config (guild_id) VALUES (?)").run(
      guildId
    );
    config = db
      .prepare("SELECT * FROM guild_config WHERE guild_id = ?")
      .get(guildId);
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
  /discord\.gg\/[a-zA-Z0-9]+/i
];

function isScam(content) {
  let score = 0;
  for (const pattern of scamPatterns) {
    if (pattern.test(content)) score++;
  }
  return score >= 2;
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
    /hypesquad-event/i
  ];
  return suspiciousDomains.some((d) => d.test(content));
}

// ============== SLASH COMMANDS REGISTRATION ==============
const commands = [
  // Setup
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("📋 Configurer Doodyx Bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Panel
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("🎛️ Ouvrir le panneau de modération")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Config channels
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("⚙️ Configurer les salons et messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("bienvenue")
        .setDescription("Configurer le salon de bienvenue")
        .addChannelOption((opt) =>
          opt
            .setName("salon")
            .setDescription("Le salon de bienvenue")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("depart")
        .setDescription("Configurer le salon de départ")
        .addChannelOption((opt) =>
          opt
            .setName("salon")
            .setDescription("Le salon de départ")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("logs")
        .setDescription("Configurer le salon de logs")
        .addChannelOption((opt) =>
          opt
            .setName("salon")
            .setDescription("Le salon de logs")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("notifs")
        .setDescription("Configurer le salon de notifications")
        .addChannelOption((opt) =>
          opt
            .setName("salon")
            .setDescription("Le salon de notifications")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("evolution")
        .setDescription("Configurer le salon d'évolution de rôle")
        .addChannelOption((opt) =>
          opt
            .setName("salon")
            .setDescription("Le salon d'évolution de rôle")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("message-bienvenue")
        .setDescription("Changer le message de bienvenue ({user} = mention)")
        .addStringOption((opt) =>
          opt
            .setName("message")
            .setDescription("Le message de bienvenue")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("message-depart")
        .setDescription("Changer le message de départ ({user} = mention)")
        .addStringOption((opt) =>
          opt
            .setName("message")
            .setDescription("Le message de départ")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("message-evolution")
        .setDescription(
          "Changer le message d'évolution ({user} = mention, {role} = rôle)"
        )
        .addStringOption((opt) =>
          opt
            .setName("message")
            .setDescription("Le message d'évolution")
            .setRequired(true)
        )
    ),

  // Moderation
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("🔨 Bannir un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) =>
      opt
        .setName("membre")
        .setDescription("Le membre à bannir")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("raison").setDescription("La raison du ban")
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("👢 Expulser un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((opt) =>
      opt
        .setName("membre")
        .setDescription("Le membre à expulser")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("raison").setDescription("La raison de l'expulsion")
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("⏰ Mettre un membre en timeout")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt
        .setName("membre")
        .setDescription("Le membre à timeout")
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("duree")
        .setDescription("Durée en minutes")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("raison").setDescription("La raison du timeout")
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("⚠️ Avertir un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt
        .setName("membre")
        .setDescription("Le membre à avertir")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("raison")
        .setDescription("La raison de l'avertissement")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("📜 Voir les avertissements d'un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt
        .setName("membre")
        .setDescription("Le membre à vérifier")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("🧹 Supprimer des messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((opt) =>
      opt
        .setName("nombre")
        .setDescription("Nombre de messages à supprimer (1-100)")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("antispam")
    .setDescription("🛡️ Activer/Désactiver l'anti-spam")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((opt) =>
      opt.setName("activer").setDescription("Activer ou non").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("antiscam")
    .setDescription("🛡️ Activer/Désactiver l'anti-scam")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((opt) =>
      opt.setName("activer").setDescription("Activer ou non").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("aide")
    .setDescription("❓ Afficher l'aide de Doodyx Bot"),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("👤 Voir les infos d'un membre")
    .addUserOption((opt) =>
      opt.setName("membre").setDescription("Le membre")
    ),

  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("📊 Voir les infos du serveur"),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("🔒 Verrouiller un salon")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("🔓 Déverrouiller un salon")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("🐌 Mettre un slowmode")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((opt) =>
      opt
        .setName("secondes")
        .setDescription("Durée du slowmode en secondes (0 = off)")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("🔓 Débannir un utilisateur")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((opt) =>
      opt
        .setName("id")
        .setDescription("L'ID de l'utilisateur à débannir")
        .setRequired(true)
    )
];

// ============== READY EVENT ==============
client.once("ready", async () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║         🎮 DOODYX BOT 🎮           ║
  ║    Connecté en tant que:            ║
  ║    ${client.user.tag.padEnd(30)}    ║
  ║    Serveurs: ${String(client.guilds.cache.size).padEnd(22)}║
  ║    Membres: ${String(client.users.cache.size).padEnd(23)}║
  ╚══════════════════════════════════════╝
  `);

  client.user.setPresence({
    activities: [
      {
        name: "la team Doodyx 🎮",
        type: 3 // WATCHING
      }
    ],
    status: "dnd"
  });

  // Register slash commands
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
});

// ============== MEMBER JOIN ==============
client.on("guildMemberAdd", async (member) => {
  const config = getGuildConfig(member.guild.id);
  if (!config?.welcome_channel) return;

  const channel = member.guild.channels.cache.get(config.welcome_channel);
  if (!channel) return;

  const message = config.welcome_message.replace(
    /{user}/g,
    `<@${member.id}>`
  );

  const embed = new EmbedBuilder()
    .setColor("#00FF88")
    .setTitle("🎉 Nouveau membre !")
    .setDescription(message)
    .setThumbnail(
      member.user.displayAvatarURL({ dynamic: true, size: 256 })
    )
    .addFields(
      {
        name: "👤 Membre",
        value: `${member.user.tag}`,
        inline: true
      },
      {
        name: "📅 Compte créé le",
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
        inline: true
      },
      {
        name: "👥 Membres",
        value: `${member.guild.memberCount}`,
        inline: true
      }
    )
    .setImage(
      "https://media.giphy.com/media/l0MYGb1LuZ3n7dRnO/giphy.gif"
    )
    .setFooter({ text: "Doodyx Bot • Bienvenue dans la team ! 💜" })
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
    .setThumbnail(
      member.user.displayAvatarURL({ dynamic: true, size: 256 })
    )
    .addFields(
      {
        name: "👤 Membre",
        value: `${member.user.tag}`,
        inline: true
      },
      {
        name: "👥 Membres restants",
        value: `${member.guild.memberCount}`,
        inline: true
      }
    )
    .setImage(
      "https://media.giphy.com/media/OPU6wzx8JrHna/giphy.gif"
    )
    .setFooter({ text: "Doodyx Bot • À bientôt ! 💜" })
    .setTimestamp();

  channel.send({ embeds: [embed] });
});

// ============== ROLE UPDATE (PROMOTION) ==============
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const config = getGuildConfig(newMember.guild.id);
  if (!config?.role_update_channel) return;

  const channel = newMember.guild.channels.cache.get(
    config.role_update_channel
  );
  if (!channel) return;

  const addedRoles = newMember.roles.cache.filter(
    (role) => !oldMember.roles.cache.has(role.id)
  );
  const removedRoles = oldMember.roles.cache.filter(
    (role) => !newMember.roles.cache.has(role.id)
  );

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
        .setThumbnail(
          newMember.user.displayAvatarURL({ dynamic: true, size: 256 })
        )
        .addFields(
          {
            name: "👤 Membre",
            value: `${newMember.user.tag}`,
            inline: true
          },
          {
            name: "🏅 Nouveau rôle",
            value: `${role.name}`,
            inline: true
          }
        )
        .setImage(
          "https://media.giphy.com/media/g9582DNuQppxC/giphy.gif"
        )
        .setFooter({
          text: "Doodyx Bot • Félicitations ! 🔥"
        })
        .setTimestamp();

      channel.send({
        content: `<@${newMember.id}>`,
        embeds: [embed]
      });
    });
  }
});

// ============== MESSAGE CREATE (ANTISPAM + ANTISCAM + COMMANDS) ==============
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const config = getGuildConfig(message.guild.id);

  // ======= ANTI-SCAM =======
  if (config?.antiscam_enabled) {
    const content = message.content;

    if (isScam(content) || isSuspiciousLink(content)) {
      try {
        await message.delete();

        // Timeout the user for 1 hour
        const member = message.guild.members.cache.get(message.author.id);
        if (member && member.moderatable) {
          await member.timeout(3600000, "🛡️ Anti-Scam Doodyx Bot");
        }

        const embed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle("🚨 SCAM/HACK DÉTECTÉ ! 🚨")
          .setDescription(
            `**⚠️ Le compte de ${message.author.tag} a possiblement été compromis !**\n\n` +
              `Le message contenait du contenu suspect (arnaque/phishing/crypto scam).\n\n` +
              `**🔒 Action:** Membre mis en timeout pendant 1 heure.\n` +
              `**💡 Conseil:** ${message.author.tag}, change ton mot de passe Discord et active le 2FA !`
          )
          .setThumbnail(
            message.author.displayAvatarURL({ dynamic: true })
          )
          .setImage(
            "https://media.giphy.com/media/3o7TKnO6Wve6502iJ2/giphy.gif"
          )
          .setFooter({
            text: "Doodyx Bot • Protection Anti-Scam 🛡️"
          })
          .setTimestamp();

        message.channel.send({ embeds: [embed] });

        // Log it
        if (config.logs_channel) {
          const logChannel = message.guild.channels.cache.get(
            config.logs_channel
          );
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setColor("#FF0000")
              .setTitle("🚨 Scam Détecté - Log")
              .addFields(
                {
                  name: "Utilisateur",
                  value: `${message.author.tag} (${message.author.id})`,
                  inline: true
                },
                {
                  name: "Salon",
                  value: `${message.channel}`,
                  inline: true
                },
                {
                  name: "Contenu supprimé",
                  value: `||${content.substring(0, 1000)}||`
                }
              )
              .setTimestamp();
            logChannel.send({ embeds: [logEmbed] });
          }
        }

        logAction(
          message.guild.id,
          "ANTISCAM",
          message.author.id,
          client.user.id,
          "Message scam/hack détecté et supprimé"
        );
      } catch (err) {
        console.error("Erreur anti-scam:", err);
      }
      return;
    }
  }

  // ======= ANTI-SPAM =======
  if (config?.antispam_enabled) {
    const member = message.guild.members.cache.get(message.author.id);
    if (member && !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      const key = `${message.guild.id}-${message.author.id}`;
      if (!client.spamMap.has(key)) {
        client.spamMap.set(key, []);
      }

      const timestamps = client.spamMap.get(key);
      timestamps.push(Date.now());

      // Clean old timestamps
      const interval = config.max_interval || 5000;
      const filtered = timestamps.filter((t) => Date.now() - t < interval);
      client.spamMap.set(key, filtered);

      if (filtered.length >= (config.max_messages || 5)) {
        try {
          if (member.moderatable) {
            await member.timeout(
              config.timeout_duration || 300000,
              "🛡️ Anti-Spam Doodyx Bot"
            );
          }

          const embed = new EmbedBuilder()
            .setColor("#FFA500")
            .setTitle("🛡️ Anti-Spam Activé")
            .setDescription(
              `${message.author.tag} a été mis en timeout pour spam.\n` +
                `**Durée:** ${(config.timeout_duration || 300000) / 60000} minutes`
            )
            .setThumbnail(
              message.author.displayAvatarURL({ dynamic: true })
            )
            .setFooter({
              text: "Doodyx Bot • Protection Anti-Spam"
            })
            .setTimestamp();

          message.channel.send({ embeds: [embed] });
          client.spamMap.set(key, []);

          logAction(
            message.guild.id,
            "ANTISPAM",
            message.author.id,
            client.user.id,
            "Timeout pour spam"
          );
        } catch (err) {
          console.error("Erreur anti-spam:", err);
        }
      }
    }
  }
});

// ============== SLASH COMMAND HANDLER ==============
client.on("interactionCreate", async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
    return;
  }

  if (interaction.isButton()) {
    await handleButton(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ======= SETUP =======
  if (commandName === "setup") {
    const embed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle("📋 Configuration de Doodyx Bot")
      .setDescription(
        "Utilise les commandes suivantes pour configurer le bot :\n\n" +
          "**Salons:**\n" +
          "`/config bienvenue` - Salon de bienvenue\n" +
          "`/config depart` - Salon de départ\n" +
          "`/config logs` - Salon de logs\n" +
          "`/config notifs` - Salon de notifications\n" +
          "`/config evolution` - Salon d'évolution de rôle\n\n" +
          "**Messages personnalisés:**\n" +
          "`/config message-bienvenue` - Message de bienvenue\n" +
          "`/config message-depart` - Message de départ\n" +
          "`/config message-evolution` - Message d'évolution\n\n" +
          "**Variables disponibles:**\n" +
          "`{user}` = mention du membre\n" +
          "`{role}` = nom du rôle (évolution uniquement)\n\n" +
          "**Modération:**\n" +
          "`/antispam` - Anti-spam\n" +
          "`/antiscam` - Anti-scam"
      )
      .setFooter({ text: "Doodyx Bot • Setup 💜" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ======= PANEL =======
  if (commandName === "panel") {
    const config = getGuildConfig(interaction.guild.id);

    const embed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle("🎛️ Panneau de Modération Doodyx")
      .setDescription("Sélectionne une catégorie ci-dessous pour gérer le bot.")
      .addFields(
        {
          name: "📢 Salons configurés",
          value:
            `Bienvenue: ${config.welcome_channel ? `<#${config.welcome_channel}>` : "❌ Non configuré"}\n` +
            `Départ: ${config.leave_channel ? `<#${config.leave_channel}>` : "❌ Non configuré"}\n` +
            `Logs: ${config.logs_channel ? `<#${config.logs_channel}>` : "❌ Non configuré"}\n` +
            `Notifs: ${config.notif_channel ? `<#${config.notif_channel}>` : "❌ Non configuré"}\n` +
            `Évolution: ${config.role_update_channel ? `<#${config.role_update_channel}>` : "❌ Non configuré"}`,
          inline: false
        },
        {
          name: "🛡️ Protection",
          value:
            `Anti-Spam: ${config.antispam_enabled ? "✅ Activé" : "❌ Désactivé"}\n` +
            `Anti-Scam: ${config.antiscam_enabled ? "✅ Activé" : "❌ Désactivé"}`,
          inline: false
        }
      )
      .setFooter({ text: "Doodyx Bot • Panel de Modération 💜" })
      .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("panel_select")
      .setPlaceholder("🔧 Choisir une action...")
      .addOptions([
        {
          label: "📢 Configurer les salons",
          description: "Changer les salons de bienvenue, départ, logs...",
          value: "config_channels",
          emoji: "📢"
        },
        {
          label: "✉️ Messages personnalisés",
          description: "Modifier les messages de bienvenue, départ...",
          value: "config_messages",
          emoji: "✉️"
        },
        {
          label: "🛡️ Anti-Spam",
          description: "Configurer l'anti-spam",
          value: "config_antispam",
          emoji: "🛡️"
        },
        {
          label: "🚨 Anti-Scam",
          description: "Configurer l'anti-scam / anti-hack",
          value: "config_antiscam",
          emoji: "🚨"
        },
        {
          label: "📊 Statistiques",
          description: "Voir les stats de modération",
          value: "stats",
          emoji: "📊"
        }
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
      db.prepare(
        "UPDATE guild_config SET welcome_channel = ? WHERE guild_id = ?"
      ).run(channel.id, guildId);
      await interaction.reply({
        content: `✅ Salon de bienvenue configuré sur ${channel} !`,
        ephemeral: true
      });
    } else if (sub === "depart") {
      const channel = interaction.options.getChannel("salon");
      db.prepare(
        "UPDATE guild_config SET leave_channel = ? WHERE guild_id = ?"
      ).run(channel.id, guildId);
      await interaction.reply({
        content: `✅ Salon de départ configuré sur ${channel} !`,
        ephemeral: true
      });
    } else if (sub === "logs") {
      const channel = interaction.options.getChannel("salon");
      db.prepare(
        "UPDATE guild_config SET logs_channel = ? WHERE guild_id = ?"
      ).run(channel.id, guildId);
      await interaction.reply({
        content: `✅ Salon de logs configuré sur ${channel} !`,
        ephemeral: true
      });
    } else if (sub === "notifs") {
      const channel = interaction.options.getChannel("salon");
      db.prepare(
        "UPDATE guild_config SET notif_channel = ? WHERE guild_id = ?"
      ).run(channel.id, guildId);
      await interaction.reply({
        content: `✅ Salon de notifications configuré sur ${channel} !`,
        ephemeral: true
      });
    } else if (sub === "evolution") {
      const channel = interaction.options.getChannel("salon");
      db.prepare(
        "UPDATE guild_config SET role_update_channel = ? WHERE guild_id = ?"
      ).run(channel.id, guildId);
      await interaction.reply({
        content: `✅ Salon d'évolution de rôle configuré sur ${channel} !`,
        ephemeral: true
      });
    } else if (sub === "message-bienvenue") {
      const msg = interaction.options.getString("message");
      db.prepare(
        "UPDATE guild_config SET welcome_message = ? WHERE guild_id = ?"
      ).run(msg, guildId);
      await interaction.reply({
        content: `✅ Message de bienvenue mis à jour !\n**Aperçu:** ${msg.replace(/{user}/g, interaction.user.tag)}`,
        ephemeral: true
      });
    } else if (sub === "message-depart") {
      const msg = interaction.options.getString("message");
      db.prepare(
        "UPDATE guild_config SET leave_message = ? WHERE guild_id = ?"
      ).run(msg, guildId);
      await interaction.reply({
        content: `✅ Message de départ mis à jour !\n**Aperçu:** ${msg.replace(/{user}/g, interaction.user.tag)}`,
        ephemeral: true
      });
    } else if (sub === "message-evolution") {
      const msg = interaction.options.getString("message");
      db.prepare(
        "UPDATE guild_config SET role_update_message = ? WHERE guild_id = ?"
      ).run(msg, guildId);
      await interaction.reply({
        content: `✅ Message d'évolution mis à jour !\n**Aperçu:** ${msg.replace(/{user}/g, interaction.user.tag).replace(/{role}/g, "Modérateur")}`,
        ephemeral: true
      });
    }
  }

  // ======= BAN =======
  if (commandName === "ban") {
    const user = interaction.options.getUser("membre");
    const reason =
      interaction.options.getString("raison") || "Aucune raison fournie";
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({
        content: "❌ Membre introuvable !",
        ephemeral: true
      });
    }
    if (!member.bannable) {
      return interaction.reply({
        content: "❌ Je ne peux pas bannir ce membre !",
        ephemeral: true
      });
    }

    try {
      // DM the user
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle("🔨 Tu as été banni")
          .setDescription(
            `Tu as été banni de **${interaction.guild.name}**\n**Raison:** ${reason}`
          )
          .setTimestamp();
        await user.send({ embeds: [dmEmbed] });
      } catch (e) {}

      await member.ban({ reason });

      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("🔨 Membre Banni")
        .addFields(
          { name: "👤 Membre", value: `${user.tag}`, inline: true },
          {
            name: "👮 Modérateur",
            value: `${interaction.user.tag}`,
            inline: true
          },
          { name: "📝 Raison", value: reason, inline: false }
        )
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: "Doodyx Bot • Modération 🔨" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(
        interaction.guild.id,
        "BAN",
        user.id,
        interaction.user.id,
        reason
      );
    } catch (err) {
      await interaction.reply({
        content: "❌ Erreur lors du ban !",
        ephemeral: true
      });
    }
  }

  // ======= KICK =======
  if (commandName === "kick") {
    const user = interaction.options.getUser("membre");
    const reason =
      interaction.options.getString("raison") || "Aucune raison fournie";
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({
        content: "❌ Membre introuvable !",
        ephemeral: true
      });
    }
    if (!member.kickable) {
      return interaction.reply({
        content: "❌ Je ne peux pas expulser ce membre !",
        ephemeral: true
      });
    }

    try {
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor("#FFA500")
          .setTitle("👢 Tu as été expulsé")
          .setDescription(
            `Tu as été expulsé de **${interaction.guild.name}**\n**Raison:** ${reason}`
          )
          .setTimestamp();
        await user.send({ embeds: [dmEmbed] });
      } catch (e) {}

      await member.kick(reason);

      const embed = new EmbedBuilder()
        .setColor("#FFA500")
        .setTitle("👢 Membre Expulsé")
        .addFields(
          { name: "👤 Membre", value: `${user.tag}`, inline: true },
          {
            name: "👮 Modérateur",
            value: `${interaction.user.tag}`,
            inline: true
          },
          { name: "📝 Raison", value: reason, inline: false }
        )
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: "Doodyx Bot • Modération 👢" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(
        interaction.guild.id,
        "KICK",
        user.id,
        interaction.user.id,
        reason
      );
    } catch (err) {
      await interaction.reply({
        content: "❌ Erreur lors de l'expulsion !",
        ephemeral: true
      });
    }
  }

  // ======= TIMEOUT =======
  if (commandName === "timeout") {
    const user = interaction.options.getUser("membre");
    const duration = interaction.options.getInteger("duree");
    const reason =
      interaction.options.getString("raison") || "Aucune raison fournie";
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({
        content: "❌ Membre introuvable !",
        ephemeral: true
      });
    }
    if (!member.moderatable) {
      return interaction.reply({
        content: "❌ Je ne peux pas timeout ce membre !",
        ephemeral: true
      });
    }

    try {
      await member.timeout(duration * 60000, reason);

      const embed = new EmbedBuilder()
        .setColor("#FFAA00")
        .setTitle("⏰ Membre en Timeout")
        .addFields(
          { name: "👤 Membre", value: `${user.tag}`, inline: true },
          {
            name: "👮 Modérateur",
            value: `${interaction.user.tag}`,
            inline: true
          },
          { name: "⏱️ Durée", value: `${duration} minutes`, inline: true },
          { name: "📝 Raison", value: reason, inline: false }
        )
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: "Doodyx Bot • Modération ⏰" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(
        interaction.guild.id,
        "TIMEOUT",
        user.id,
        interaction.user.id,
        `${duration}min - ${reason}`
      );
    } catch (err) {
      await interaction.reply({
        content: "❌ Erreur lors du timeout !",
        ephemeral: true
      });
    }
  }

  // ======= WARN =======
  if (commandName === "warn") {
    const user = interaction.options.getUser("membre");
    const reason = interaction.options.getString("raison");

    db.prepare(
      "INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)"
    ).run(interaction.guild.id, user.id, interaction.user.id, reason);

    const warnCount = db
      .prepare(
        "SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND user_id = ?"
      )
      .get(interaction.guild.id, user.id).count;

    const embed = new EmbedBuilder()
      .setColor("#FFFF00")
      .setTitle("⚠️ Avertissement")
      .addFields(
        { name: "👤 Membre", value: `${user.tag}`, inline: true },
        {
          name: "👮 Modérateur",
          value: `${interaction.user.tag}`,
          inline: true
        },
        {
          name: "📊 Total warns",
          value: `${warnCount}`,
          inline: true
        },
        { name: "📝 Raison", value: reason, inline: false }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: "Doodyx Bot • Avertissement ⚠️" })
      .setTimestamp();

    // Auto actions based on warn count
    let autoAction = "";
    const member = interaction.guild.members.cache.get(user.id);
    if (warnCount >= 5 && member?.bannable) {
      await member.ban({ reason: "5 avertissements atteints" });
      autoAction = "\n\n🔨 **Auto-ban:** 5 avertissements atteints !";
    } else if (warnCount >= 3 && member?.moderatable) {
      await member.timeout(3600000, "3 avertissements atteints");
      autoAction =
        "\n\n⏰ **Auto-timeout (1h):** 3 avertissements atteints !";
    }

    if (autoAction) {
      embed.setDescription(autoAction);
    }

    await interaction.reply({ embeds: [embed] });
    logAction(
      interaction.guild.id,
      "WARN",
      user.id,
      interaction.user.id,
      reason
    );
  }

  // ======= WARNINGS =======
  if (commandName === "warnings") {
    const user = interaction.options.getUser("membre");
    const warns = db
      .prepare(
        "SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 10"
      )
      .all(interaction.guild.id, user.id);

    if (warns.length === 0) {
      return interaction.reply({
        content: `✅ ${user.tag} n'a aucun avertissement !`,
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor("#FFFF00")
      .setTitle(`📜 Avertissements de ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setDescription(
        warns
          .map(
            (w, i) =>
              `**${i + 1}.** ${w.reason}\n└ Par <@${w.moderator_id}> • ${w.timestamp}`
          )
          .join("\n\n")
      )
      .setFooter({
        text: `Total: ${warns.length} avertissement(s) • Doodyx Bot`
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ======= CLEAR =======
  if (commandName === "clear") {
    const amount = interaction.options.getInteger("nombre");
    if (amount < 1 || amount > 100) {
      return interaction.reply({
        content: "❌ Le nombre doit être entre 1 et 100 !",
        ephemeral: true
      });
    }

    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);

      const embed = new EmbedBuilder()
        .setColor("#00BFFF")
        .setTitle("🧹 Messages Supprimés")
        .setDescription(
          `**${deleted.size}** messages ont été supprimés par ${interaction.user.tag}`
        )
        .setFooter({ text: "Doodyx Bot • Nettoyage 🧹" })
        .setTimestamp();

      const reply = await interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
      logAction(
        interaction.guild.id,
        "CLEAR",
        interaction.user.id,
        interaction.user.id,
        `${deleted.size} messages supprimés`
      );
    } catch (err) {
      await interaction.reply({
        content:
          "❌ Erreur ! Les messages de plus de 14 jours ne peuvent pas être supprimés en masse.",
        ephemeral: true
      });
    }
  }

  // ======= ANTISPAM TOGGLE =======
  if (commandName === "antispam") {
    const enabled = interaction.options.getBoolean("activer");
    db.prepare(
      "UPDATE guild_config SET antispam_enabled = ? WHERE guild_id = ?"
    ).run(enabled ? 1 : 0, interaction.guild.id);

    await interaction.reply({
      content: `✅ Anti-spam ${enabled ? "**activé** 🛡️" : "**désactivé** ❌"}`,
      ephemeral: true
    });
  }

  // ======= ANTISCAM TOGGLE =======
  if (commandName === "antiscam") {
    const enabled = interaction.options.getBoolean("activer");
    db.prepare(
      "UPDATE guild_config SET antiscam_enabled = ? WHERE guild_id = ?"
    ).run(enabled ? 1 : 0, interaction.guild.id);

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
      .setDescription("Voici toutes les commandes disponibles :")
      .addFields(
        {
          name: "⚙️ Configuration",
          value:
            "`/setup` - Guide de configuration\n`/panel` - Panneau de modération\n`/config` - Configurer les salons et messages",
          inline: false
        },
        {
          name: "🔨 Modération",
          value:
            "`/ban` - Bannir un membre\n`/kick` - Expulser un membre\n`/timeout` - Timeout un membre\n`/warn` - Avertir un membre\n`/warnings` - Voir les warns\n`/clear` - Supprimer des messages\n`/unban` - Débannir",
          inline: false
        },
        {
          name: "🔧 Outils",
          value:
            "`/lock` - Verrouiller un salon\n`/unlock` - Déverrouiller un salon\n`/slowmode` - Mode lent\n`/userinfo` - Infos membre\n`/serverinfo` - Infos serveur",
          inline: false
        },
        {
          name: "🛡️ Protection",
          value:
            "`/antispam` - Anti-spam\n`/antiscam` - Anti-scam/hack\n\n🔒 Détecte automatiquement :\n• Faux liens Discord Nitro\n• Arnaques crypto/MrBeast\n• Comptes hackés\n• Liens de phishing",
          inline: false
        }
      )
      .setFooter({ text: "Doodyx Bot v1.0 💜" })
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
        {
          name: "📅 Compte créé",
          value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
          inline: true
        },
        {
          name: "📥 A rejoint le",
          value: member
            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
            : "N/A",
          inline: true
        },
        {
          name: "🏅 Rôles",
          value: member
            ? member.roles.cache
                .filter((r) => r.name !== "@everyone")
                .map((r) => r)
                .join(", ") || "Aucun"
            : "N/A",
          inline: false
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
        {
          name: "👑 Propriétaire",
          value: `<@${guild.ownerId}>`,
          inline: true
        },
        {
          name: "👥 Membres",
          value: `${guild.memberCount}`,
          inline: true
        },
        {
          name: "💬 Salons",
          value: `${guild.channels.cache.size}`,
          inline: true
        },
        {
          name: "🏅 Rôles",
          value: `${guild.roles.cache.size}`,
          inline: true
        },
        {
          name: "😀 Emojis",
          value: `${guild.emojis.cache.size}`,
          inline: true
        },
        {
          name: "📅 Créé le",
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
          inline: true
        },
        {
          name: "🔒 Niveau de vérif",
          value: `${guild.verificationLevel}`,
          inline: true
        }
      )
      .setFooter({ text: "Doodyx Bot 💜" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // ======= LOCK =======
  if (commandName === "lock") {
    try {
      await interaction.channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: false }
      );

      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("🔒 Salon Verrouillé")
        .setDescription(
          `Ce salon a été verrouillé par ${interaction.user.tag}`
        )
        .setFooter({ text: "Doodyx Bot 🔒" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(
        interaction.guild.id,
        "LOCK",
        interaction.channel.id,
        interaction.user.id,
        `Salon verrouillé`
      );
    } catch (err) {
      await interaction.reply({
        content: "❌ Erreur lors du verrouillage !",
        ephemeral: true
      });
    }
  }

  // ======= UNLOCK =======
  if (commandName === "unlock") {
    try {
      await interaction.channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: true }
      );

      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("🔓 Salon Déverrouillé")
        .setDescription(
          `Ce salon a été déverrouillé par ${interaction.user.tag}`
        )
        .setFooter({ text: "Doodyx Bot 🔓" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(
        interaction.guild.id,
        "UNLOCK",
        interaction.channel.id,
        interaction.user.id,
        `Salon déverrouillé`
      );
    } catch (err) {
      await interaction.reply({
        content: "❌ Erreur lors du déverrouillage !",
        ephemeral: true
      });
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
        .setDescription(
          seconds === 0
            ? "Le slowmode a été **désactivé**."
            : `Slowmode réglé sur **${seconds} secondes**.`
        )
        .setFooter({ text: "Doodyx Bot 🐌" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      await interaction.reply({
        content: "❌ Erreur !",
        ephemeral: true
      });
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
        .setDescription(`L'utilisateur <@${userId}> a été débanni.`)
        .setFooter({ text: "Doodyx Bot 🔓" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logAction(
        interaction.guild.id,
        "UNBAN",
        userId,
        interaction.user.id,
        "Débanni"
      );
    } catch (err) {
      await interaction.reply({
        content: "❌ Utilisateur introuvable dans les bans !",
        ephemeral: true
      });
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
          "Utilise les commandes suivantes :\n\n" +
            "`/config bienvenue #salon` - Salon de bienvenue\n" +
            "`/config depart #salon` - Salon de départ\n" +
            "`/config logs #salon` - Salon de logs\n" +
            "`/config notifs #salon` - Salon de notifications\n" +
            "`/config evolution #salon` - Salon d'évolution de rôle"
        )
        .setFooter({ text: "Doodyx Bot 💜" });

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
            "**Pour modifier :**\n" +
            "`/config message-bienvenue [message]`\n" +
            "`/config message-depart [message]`\n" +
            "`/config message-evolution [message]`\n\n" +
            "**Variables :** `{user}` = mention, `{role}` = rôle"
        )
        .setFooter({ text: "Doodyx Bot 💜" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (value === "config_antispam") {
      const embed = new EmbedBuilder()
        .setColor("#FF6B6B")
        .setTitle("🛡️ Anti-Spam")
        .setDescription(
          `**Statut:** ${config.antispam_enabled ? "✅ Activé" : "❌ Désactivé"}\n` +
            `**Max messages:** ${config.max_messages} en ${config.max_interval / 1000}s\n` +
            `**Durée timeout:** ${config.timeout_duration / 60000} minutes\n\n` +
            "**Commande:** `/antispam activer:true/false`"
        )
        .setFooter({ text: "Doodyx Bot 💜" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (value === "config_antiscam") {
      const embed = new EmbedBuilder()
        .setColor("#FF6B6B")
        .setTitle("🚨 Anti-Scam / Anti-Hack")
        .setDescription(
          `**Statut:** ${config.antiscam_enabled ? "✅ Activé" : "❌ Désactivé"}\n\n` +
            "**Détecte automatiquement :**\n" +
            "• 🎮 Faux liens Discord Nitro\n" +
            "• 💰 Arnaques Crypto (Bitcoin, Ethereum, NFT)\n" +
            "• 🎬 Faux giveaways MrBeast\n" +
            '• 🔓 Comptes hackés ("envoie X BTC")\n' +
            "• 🔗 Liens de phishing (faux Discord, Steam)\n" +
            "• 🎣 Tentatives de vol de compte\n" +
            "• 📧 Liens raccourcis suspects\n\n" +
            "**Action:** Suppression du message + Timeout 1h\n\n" +
            "**Commande:** `/antiscam activer:true/false`"
        )
        .setFooter({ text: "Doodyx Bot 💜" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (value === "stats") {
      const totalWarns = db
        .prepare(
          "SELECT COUNT(*) as count FROM warnings WHERE guild_id = ?"
        )
        .get(interaction.guild.id).count;
      const totalActions = db
        .prepare(
          "SELECT COUNT(*) as count FROM mod_logs WHERE guild_id = ?"
        )
        .get(interaction.guild.id).count;
      const recentActions = db
        .prepare(
          "SELECT * FROM mod_logs WHERE guild_id = ? ORDER BY timestamp DESC LIMIT 5"
        )
        .all(interaction.guild.id);

      const embed = new EmbedBuilder()
        .setColor("#FF6B6B")
        .setTitle("📊 Statistiques de Modération")
        .addFields(
          {
            name: "⚠️ Total Warns",
            value: `${totalWarns}`,
            inline: true
          },
          {
            name: "📋 Total Actions",
            value: `${totalActions}`,
            inline: true
          },
          {
            name: "👥 Membres",
            value: `${interaction.guild.memberCount}`,
            inline: true
          },
          {
            name: "📜 Actions Récentes",
            value:
              recentActions.length > 0
                ? recentActions
                    .map(
                      (a) =>
                        `**${a.action}** - <@${a.user_id}> par <@${a.moderator_id}>`
                    )
                    .join("\n")
                : "Aucune action récente",
            inline: false
          }
        )
        .setFooter({ text: "Doodyx Bot 💜" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}

async function handleButton(interaction) {
  // Future button handlers
  await interaction.reply({
    content: "🔧 En cours de développement !",
    ephemeral: true
  });
}

// ============== LOGIN ==============
client.login(process.env.TOKEN);
