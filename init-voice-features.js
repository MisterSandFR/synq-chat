// Script d'initialisation des fonctionnalités vocales dans MongoDB
// À exécuter après le déploiement

print("🎤 Initialisation des fonctionnalités vocales Synq Chat...");

// Activer les paramètres vocaux
db.rocketchat_settings.updateMany(
  { _id: { $in: [
    "Synq_Native_Voice_Enabled",
    "Synq_Voice_Persistent_Rooms", 
    "Synq_Voice_Screen_Share_Enabled",
    "Synq_Voice_Chat_Enabled",
    "Synq_Voice_Encryption_Enabled",
    "Synq_Voice_Moderation_Enabled",
    "Synq_Voice_Presence_Notifications",
    "Synq_Voice_Speech_Detection",
    "Synq_Voice_Noise_Reduction",
    "Synq_Voice_Echo_Cancellation",
    "Synq_Voice_Auto_Quality_Adaptation",
    "Synq_Voice_Audio_Compression",
    "Synq_Voice_Video_Compression",
    "Synq_Voice_Require_Auth",
    "Synq_Voice_Call_Logs",
    "WebRTC_Enabled",
    "WebRTC_Enable_Direct",
    "WebRTC_Enable_Private", 
    "WebRTC_Enable_Channel"
  ]}},
  { $set: { value: true } }
);

// Configurer les valeurs numériques
db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Max_Participants" },
  { $set: { value: 50 } }
);

db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Audio_Quality" },
  { $set: { value: "high" } }
);

db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Video_Quality" },
  { $set: { value: "high" } }
);

db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Bandwidth_Limit" },
  { $set: { value: 0 } }
);

// Configurer les serveurs WebRTC
db.rocketchat_settings.updateMany(
  { _id: "WebRTC_Servers" },
  { $set: { value: "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302" } }
);

// Configurer les salles par défaut
db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Default_Rooms" },
  { $set: { value: "[]" } }
);

// Configurer les permissions
db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Role_Permissions" },
  { $set: { value: "{}" } }
);

// Désactiver l'enregistrement par défaut
db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Recording_Enabled" },
  { $set: { value: false } }
);

print("✅ Configuration des fonctionnalités vocales terminée !");
print("🎤 Les salles vocales natives sont maintenant activées");
print("📹 Les appels audio/vidéo natifs sont configurés");
print("🖥️ Le partage d'écran natif est activé");
print("💬 Le chat intégré est configuré");
print("🔐 La sécurité et le chiffrement sont activés");

// Afficher les paramètres configurés
print("\n📋 Paramètres configurés:");
db.rocketchat_settings.find({
  _id: { $regex: "Synq_Voice|WebRTC" }
}).forEach(function(setting) {
  print("- " + setting._id + ": " + setting.value);
});
