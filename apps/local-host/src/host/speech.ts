import type { HostMessage, HostRequest } from "@contextual/core";
import { SystemSpeechService } from "../platform/speech";

export function createSpeechHandler(
  reply: (message: HostMessage) => void,
  service = new SystemSpeechService(),
) {
  return {
    close: () => service.close(),
    async handle(request: HostRequest): Promise<boolean> {
      if (request.type === "listSpeechVoices") {
        reply({
          id: request.id,
          type: "speechVoices",
          supported: service.supported,
          experimentalBackend: service.experimentalBackend,
          voices: service.supported ? await service.listVoices() : [],
        });
      } else if (request.type === "listSpeechVoiceCatalog") {
        reply({
          id: request.id,
          type: "speechVoiceCatalog",
          catalog: await service.listVoiceCatalog(),
        });
      } else if (request.type === "getSpeechVoiceFolder") {
        reply({
          id: request.id,
          type: "speechVoiceFolder",
          voiceId: request.voiceId,
          directory: await service.voiceFolder(request.voiceId),
        });
      } else if (request.type === "openSpeechVoiceFolder") {
        reply({
          id: request.id,
          type: "speechVoiceFolderOpened",
          voiceId: request.voiceId,
          directory: await service.openVoiceFolder(request.voiceId),
        });
      } else if (request.type === "removeSpeechVoice") {
        await service.removeVoice(request.voiceId);
        reply({ id: request.id, type: "speechVoiceRemoved", voiceId: request.voiceId });
      } else if (request.type === "installSpeechVoice") {
        reply({
          id: request.id,
          type: "speechVoiceInstallation",
          installation: await service.installVoice(request.voiceId),
        });
      } else if (request.type === "getSpeechVoiceInstallation") {
        reply({
          id: request.id,
          type: "speechVoiceInstallation",
          installation: await service.voiceInstallation(request.voiceId),
        });
      } else if (request.type === "speak") {
        reply({
          id: request.id,
          type: "speechFinished",
          status: await service.speak(request.id, request.input),
        });
      } else if (request.type === "stopSpeech") {
        await service.stop(request.speechId);
        reply({ id: request.id, type: "speechStopped" });
      } else return false;
      return true;
    },
  };
}
