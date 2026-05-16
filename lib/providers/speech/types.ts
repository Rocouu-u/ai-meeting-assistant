export type SpeechSubmitOptions = {
  diarizationEnabled?: boolean;
  fileBuffer?: Buffer;
  sourceFileName?: string;
  sourceFileType?: string;
  uploadElapsedMs?: number;
};

export type SpeechPollOptions = {
  diarizationEnabled?: boolean;
};

export type TranscriptSegment = {
  text: string;
  speakerId?: string | null;
  speakerName?: string | null;
  beginTime?: number | null;
  endTime?: number | null;
  timestamp?: string;
};

export type SpeechSubmitResult = {
  status: "queued" | "processing" | "completed" | "error";
  transcriptId: string;
  message: string;
  rawStatus?: string;
  transcript?: string;
  segments?: TranscriptSegment[];
};

export type SpeechPollResult = {
  status: "queued" | "processing" | "completed" | "error";
  message: string;
  transcript?: string;
  rawStatus?: string;
  elapsedMs?: number;
  segments?: TranscriptSegment[];
};

export type SpeechProvider = {
  name: string;
  submit(file: File, options?: SpeechSubmitOptions): Promise<SpeechSubmitResult>;
  submitAudioUrl(audioUrl: string, options?: SpeechSubmitOptions): Promise<SpeechSubmitResult>;
  poll(transcriptId: string, options?: SpeechPollOptions): Promise<SpeechPollResult>;
};
