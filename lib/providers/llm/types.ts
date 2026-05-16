export type GenerateMeetingReportInput = {
  transcript: string;
};

export type ActionItem = {
  topic: string;
  owner: string;
  expectedResult: string;
  deadline: string;
  sourceTimestamp: string;
};

export type GenerateMeetingReportResult = {
  message: string;
  summary: string;
  outline: string;
  actionItems: ActionItem[];
};

export type LlmProvider = {
  name: string;
  generateMeetingReport(input: GenerateMeetingReportInput): Promise<GenerateMeetingReportResult>;
};
