"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

type TaskStatus =
  | "idle"
  | "queued"
  | "uploading"
  | "transcribing"
  | "summarizing"
  | "completed"
  | "failed"
  | "still_processing";

type MeetingRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  date: string;
  duration: string;
  status: string;
  taskStatus: TaskStatus;
  transcript: string;
  summary: string;
  outline: string;
  actionItems: ActionItem[];
  audioFileName?: string;
  audioFileSize?: string;
  audioFileType?: string;
  audioFileSizeBytes?: number;
  durationSeconds?: number;
  transcriptId?: string;
  uploadProgress?: number;
  uploadNotice?: string;
  transcribeElapsedText?: string;
  errorMessage?: string;
  transcriptSegments?: TranscriptSegment[];
};

type ActionItem = {
  topic: string;
  owner: string;
  expectedResult: string;
  deadline: string;
  sourceTimestamp: string;
};

type TranscriptSegment = {
  text: string;
  speakerId?: string | null;
  speakerName?: string | null;
  beginTime?: number | null;
  endTime?: number | null;
  timestamp?: string;
};

type QueueItem = {
  recordId: string;
  file: File;
};

type TranscribeResponse = {
  ok?: boolean;
  status?: "queued" | "processing" | "completed" | "error";
  rawStatus?: string;
  message?: string;
  transcriptId?: string;
  transcript?: string;
  elapsedMs?: number;
  segments?: TranscriptSegment[];
};

type OssUploadPolicyResponse = {
  ok?: boolean;
  enabled?: boolean;
  message?: string;
  uploadUrl?: string;
  fileUrl?: string;
  fields?: Record<string, string>;
};

type GenerateReportResponse = {
  ok?: boolean;
  message?: string;
  summary?: string;
  outline?: string;
  actionItems?: ActionItem[];
};

type AppConfigResponse = {
  ok?: boolean;
  recordRetentionDays?: number;
  ossAudioRetentionDays?: number;
};

type StoredMeetingRecord = {
  id: string;
  title: string;
  originalFileName?: string;
  fileSize?: number;
  fileSizeLabel?: string;
  fileType?: string;
  duration?: string;
  durationSeconds?: number;
  status?: string;
  taskStatus?: TaskStatus;
  transcript?: string;
  summary?: string;
  outline?: string;
  todos?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
  transcriptId?: string;
};

type HistoryResponse = {
  ok?: boolean;
  message?: string;
  records?: StoredMeetingRecord[];
  record?: StoredMeetingRecord;
  importedCount?: number;
  deletedCount?: number;
};

type PublicRuntimeConfig = {
  dashscopeApiKeyConfigured: boolean;
  dashscopeApiKeySaved: boolean;
  dashscopeApiKeyMasked: string;
  hfTokenConfigured: boolean;
  hfTokenSaved: boolean;
  hfTokenMasked: string;
  ossEnabled: boolean;
  ossRegion: string;
  ossBucket: string;
  ossConfigured: boolean;
  ossAccessKeyIdConfigured: boolean;
  ossAccessKeyIdSaved: boolean;
  ossAccessKeyIdMasked: string;
  ossAccessKeySecretConfigured: boolean;
  ossAccessKeySecretSaved: boolean;
  ossAccessKeySecretMasked: string;
  usingEnvFallback: boolean;
  setupComplete: boolean;
};

type SettingsResponse = {
  ok?: boolean;
  message?: string;
  config?: PublicRuntimeConfig;
};

type ConfigDisplayStatus = "未配置" | "已配置" | "测试通过" | "测试失败";

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

const buttonBase =
  "rounded-lg border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50";
const localRecordsStorageKey = "meeting-ai-assistant.records";
const maxConcurrentUploads = 2;
const transcribePollIntervalMs = 5000;
const transcribeMaxPollAttempts = 240;
const longAudioNoticeAfterMs = 2 * 60 * 1000;
const ossNoProgressTimeoutMs = 75 * 1000;
const ossSlowNoticeAfterMs = 5 * 60 * 1000;
const defaultRecordRetentionDays = 30;
const defaultOssAudioRetentionDays = 7;
const defaultOssRegion = "oss-cn-hangzhou";
const ossRegionOptions = [
  { label: "华东1（杭州）oss-cn-hangzhou，推荐", value: "oss-cn-hangzhou" },
  { label: "华东2（上海）oss-cn-shanghai", value: "oss-cn-shanghai" },
  { label: "华北2（北京）oss-cn-beijing", value: "oss-cn-beijing" },
  { label: "华南1（深圳）oss-cn-shenzhen", value: "oss-cn-shenzhen" }
];
const transcribingTitle = "正在转写音频，请稍候…";
const transcribingDescription = "系统正在识别录音内容，长音频可能需要几分钟。任务提交后，可稍后在历史记录中查看结果。";
const longTranscribingDescription = "音频仍在处理中，长音频可能需要更久，请耐心等待。";
const emptyRecord: MeetingRecord = {
  id: "new-meeting",
  title: "新建会议",
  createdAt: new Date().toISOString(),
  date: "尚未上传",
  duration: "待识别",
  status: "等待上传",
  taskStatus: "idle",
  transcript: "",
  summary: "",
  outline: "",
  actionItems: []
};

export default function Home() {
  const [records, setRecords] = useState<MeetingRecord[]>([]);
  const [activeId, setActiveId] = useState(emptyRecord.id);
  const [notice, setNotice] = useState("");
  const [generateStatus, setGenerateStatus] = useState("");
  const [isExportingWord, setIsExportingWord] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<PublicRuntimeConfig | null>(null);
  const [settingsStatus, setSettingsStatus] = useState("");
  const [currentOrigin, setCurrentOrigin] = useState("");
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [recordRetentionDays, setRecordRetentionDays] = useState(defaultRecordRetentionDays);
  const [hasLoadedLocalRecords, setHasLoadedLocalRecords] = useState(false);
  const uploadQueueRef = useRef<QueueItem[]>([]);
  const activeUploadCountRef = useRef(0);
  const uploadXhrRefs = useRef(new Map<string, XMLHttpRequest>());
  const abortReasonsRef = useRef(new Map<string, "user" | "stall">());
  const recordsRef = useRef<MeetingRecord[]>([]);
  const [audioObjectUrls, setAudioObjectUrls] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  const activeRecord = useMemo(
    () => records.find((record) => record.id === activeId) ?? emptyRecord,
    [activeId, records]
  );
  const pendingCount = records.filter((record) => record.taskStatus === "queued").length;
  const hasAnyRecord = records.length > 0;
  const hasUsableTranscript =
    Boolean(activeRecord.transcript.trim()) &&
    !["uploading", "transcribing", "still_processing", "failed", "queued", "idle"].includes(activeRecord.taskStatus);
  const currentAudioUrl = audioObjectUrls[activeRecord.id] ?? null;

  useEffect(() => {
    setCurrentOrigin(window.location.origin);
    void loadSettings();
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadConfig() {
      try {
        const response = await fetch("/api/app-config");
        const result = (await response.json()) as AppConfigResponse;

        if (!mounted || !result.ok) {
          return;
        }

        setRecordRetentionDays(result.recordRetentionDays ?? defaultRecordRetentionDays);
        void result.ossAudioRetentionDays;
      } catch {
        // 配置读取失败时使用默认保留时间。
      }
    }

    void loadConfig();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setIsAudioPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  }, [activeRecord.id]);

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/settings");
      const result = (await response.json()) as SettingsResponse;

      if (!response.ok || !result.ok || !result.config) {
        return;
      }

      setSettings(result.config);
    } catch {
      setSettings(null);
    }
  };

  useEffect(() => {
    let mounted = true;

    async function loadHistory() {
      try {
        const response = await fetch("/api/history");
        const result = (await response.json()) as HistoryResponse;
        const sqliteRecords = result.ok && Array.isArray(result.records) ? result.records.map(fromStoredRecord) : [];
        const localRecords = readLocalRecords(recordRetentionDays);

        if (localRecords.length > 0) {
          await fetch("/api/history", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              records: localRecords.map(toStoredRecord)
            })
          });
        }

        const mergedRecords =
          localRecords.length > 0
            ? await fetchHistoryRecords()
            : sqliteRecords.filter((record) => isRecordRetained(record, recordRetentionDays));

        if (!mounted) {
          return;
        }

        recordsRef.current = mergedRecords;
        setRecords(mergedRecords);
        setActiveId(mergedRecords[0]?.id ?? emptyRecord.id);
      } catch {
        const fallbackRecords = readLocalRecords(recordRetentionDays);

        if (!mounted) {
          return;
        }

        recordsRef.current = fallbackRecords;
        setRecords(fallbackRecords);
        setActiveId(fallbackRecords[0]?.id ?? emptyRecord.id);
      } finally {
        if (mounted) {
          setHasLoadedLocalRecords(true);
        }
      }
    }

    void loadHistory();

    return () => {
      mounted = false;
    };
  }, [recordRetentionDays]);

  useEffect(() => {
    recordsRef.current = records;

    if (!hasLoadedLocalRecords) {
      return;
    }

    window.localStorage.setItem(localRecordsStorageKey, JSON.stringify(records));
  }, [hasLoadedLocalRecords, records]);

  // 当 activeId 变化时，若没有 blob URL 就从服务端接口补上音频地址（历史记录场景）
  useEffect(() => {
    if (!activeId || !hasLoadedLocalRecords) return;
    setAudioObjectUrls((prev) => {
      if (prev[activeId]) return prev;
      const rec = recordsRef.current.find((r) => r.id === activeId);
      if (!rec?.transcriptId) return prev;
      return { ...prev, [activeId]: `/api/audio/${rec.transcriptId}` };
    });
  }, [activeId, hasLoadedLocalRecords]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const updateRecordById = (recordId: string, patch: Partial<MeetingRecord>, options: { persist?: boolean } = {}) => {
    const currentRecords = recordsRef.current;
    const currentRecord = currentRecords.find((record) => record.id === recordId);

    if (!currentRecord) {
      return;
    }

    const updatedRecord = {
      ...currentRecord,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    const updatedRecords = currentRecords.map((record) => (record.id === recordId ? updatedRecord : record));

    recordsRef.current = updatedRecords;
    setRecords(updatedRecords);

    if (options.persist !== false) {
      void updateHistoryRecord(updatedRecord);
    }
  };

  const updateActiveRecord = (patch: Partial<MeetingRecord>) => {
    updateRecordById(activeRecord.id, patch);
  };

  const updateRecord = (field: keyof Pick<MeetingRecord, "transcript" | "summary" | "outline">, value: string) => {
    updateActiveRecord({ [field]: value });
  };

  const openNewMeeting = () => {
    setActiveId(emptyRecord.id);
    setGenerateStatus("");
    showNotice("可以选择一个或多个会议录音");
  };

  const openRecord = (recordId: string) => {
    setActiveId(recordId);
    setGenerateStatus("");
    // 若没有 blob URL（历史记录），用服务端音频接口
    setAudioObjectUrls((prev) => {
      if (prev[recordId]) return prev;
      const rec = recordsRef.current.find((r) => r.id === recordId);
      if (!rec?.transcriptId) return prev;
      return { ...prev, [recordId]: `/api/audio/${rec.transcriptId}` };
    });
  };

  const toggleSelectedRecord = (recordId: string) => {
    setSelectedRecordIds((currentIds) =>
      currentIds.includes(recordId) ? currentIds.filter((id) => id !== recordId) : [...currentIds, recordId]
    );
  };

  const renameRecord = (recordId: string) => {
    const record = records.find((item) => item.id === recordId);
    const nextTitle = window.prompt("请输入新的记录名称", record?.title ?? "");

    if (!nextTitle?.trim()) {
      return;
    }

    updateRecordById(
      recordId,
      {
        title: nextTitle.trim()
      },
      { persist: false }
    );
    void renameHistoryRecord(recordId, nextTitle.trim());
    showNotice("记录已重命名");
  };

  const deleteRecord = (recordId: string) => {
    const record = records.find((item) => item.id === recordId);

    if (!window.confirm(`确定删除“${record?.title ?? "这条记录"}”吗？删除后不可恢复。`)) {
      return;
    }

    abortUpload(recordId);
    if (audioObjectUrls[recordId]) {
      URL.revokeObjectURL(audioObjectUrls[recordId]);
      setAudioObjectUrls((prev) => { const next = { ...prev }; delete next[recordId]; return next; });
    }
    const nextRecords = recordsRef.current.filter((item) => item.id !== recordId);
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    setSelectedRecordIds((currentIds) => currentIds.filter((id) => id !== recordId));
    void deleteHistoryRecord(recordId);

    if (activeId === recordId) {
      const nextRecord = nextRecords[0];
      setActiveId(nextRecord?.id ?? emptyRecord.id);
    }

    showNotice("记录已删除");
  };

  const deleteSelectedRecords = () => {
    if (selectedRecordIds.length === 0) {
      showNotice("请先选择要删除的记录");
      return;
    }

    if (!window.confirm(`确定删除选中的 ${selectedRecordIds.length} 条记录吗？删除后不可恢复。`)) {
      return;
    }

    selectedRecordIds.forEach(abortUpload);
    selectedRecordIds.forEach((id) => {
      if (audioObjectUrls[id]) URL.revokeObjectURL(audioObjectUrls[id]);
    });
    setAudioObjectUrls((prev) => {
      const next = { ...prev };
      selectedRecordIds.forEach((id) => delete next[id]);
      return next;
    });
    const nextRecords = recordsRef.current.filter((record) => !selectedRecordIds.includes(record.id));
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    void batchDeleteHistoryRecords(selectedRecordIds);

    if (selectedRecordIds.includes(activeId)) {
      const nextRecord = nextRecords[0];
      setActiveId(nextRecord?.id ?? emptyRecord.id);
    }

    setSelectedRecordIds([]);
    showNotice("已删除选中记录");
  };

  const handleAudioFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);

    if (files.length > 0) {
      selectAudioFiles(files);
    }

    event.target.value = "";
  };

  const handleAudioDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingAudio(true);
  };

  const handleAudioDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingAudio(false);
  };

  const handleAudioDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingAudio(false);

    const files = Array.from(event.dataTransfer.files ?? []);

    if (files.length > 0) {
      selectAudioFiles(files);
    }
  };

  const selectAudioFiles = (files: File[]) => {
    const validFiles = files.filter(isSupportedAudioFile);
    const invalidCount = files.length - validFiles.length;

    if (invalidCount > 0) {
      showNotice(`${invalidCount} 个文件格式不支持，请选择 mp3、wav、m4a、mp4。`);
    }

    if (validFiles.length === 0) {
      return;
    }

    const now = Date.now();
    const newAudioUrls: Record<string, string> = {};
    const newRecords = validFiles.map((file, index) => {
      const recordId = `meeting-${now}-${index}`;
      const title = file.name.replace(/\.[^/.]+$/, "") || "新的会议录音";

      newAudioUrls[recordId] = URL.createObjectURL(file);

      uploadQueueRef.current.push({
        recordId,
        file
      });

      readAudioDuration(file).then((durationSeconds) => {
        if (!durationSeconds) {
          return;
        }

        updateRecordById(recordId, {
          duration: formatDuration(durationSeconds),
          durationSeconds
        });
      });

      return createRecordFromFile(recordId, title, file);
    });

    const nextRecords = [...newRecords, ...recordsRef.current];
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    setActiveId(newRecords[0].id);
    setAudioObjectUrls((prev) => ({ ...prev, ...newAudioUrls }));
    showNotice(`已创建 ${newRecords.length} 条转写任务`);
    processUploadQueue();
    void Promise.allSettled(newRecords.map(createHistoryRecord));
  };

  const processUploadQueue = () => {
    while (activeUploadCountRef.current < maxConcurrentUploads && uploadQueueRef.current.length > 0) {
      const item = uploadQueueRef.current.shift();

      if (!item) {
        return;
      }

      activeUploadCountRef.current += 1;
      void processQueuedFile(item).finally(() => {
        activeUploadCountRef.current = Math.max(0, activeUploadCountRef.current - 1);
        processUploadQueue();
      });
    }
  };

  const processQueuedFile = async ({ recordId, file }: QueueItem) => {
    updateRecordById(recordId, {
      status: "上传中",
      taskStatus: "uploading",
      uploadProgress: 0,
      uploadNotice: "正在上传音频，请稍候。",
      transcript: "音频上传中，请稍候。\n\n长音频处理时间会受网络和录音质量影响，请保持页面打开直到任务提交成功。",
      errorMessage: "",
      transcriptSegments: []
    });

    try {
      const { result, response } = await submitTranscription(file, recordId);

      if (!response.ok || !result.ok || !result.transcriptId) {
        const message = getFriendlyTranscribeError(result.message);
        markRecordFailed(recordId, message);
        return;
      }

      updateRecordById(recordId, {
        status: "转写中",
        taskStatus: "transcribing",
        transcriptId: result.transcriptId,
        transcript: `${transcribingTitle}\n\n${transcribingDescription}`,
        uploadNotice: "任务已提交，正在转写音频。"
      });

      const transcriptionResult = await pollTranscriptionResult(result.transcriptId, recordId);

      if (!transcriptionResult) {
        return;
      }

      await generateReportForRecord(recordId, transcriptionResult.transcript);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "转写失败，请重试或检查音频文件。";

      markRecordFailed(recordId, message);
    }
  };

  const submitTranscription = async (file: File, recordId: string) => {
    const ossAttempt = await trySubmitWithOssDirectUpload(file, recordId);

    if (ossAttempt) {
      return ossAttempt;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("transcribeMode", "standard");

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData
    });
    const result = await readJsonResponse<TranscribeResponse>(response);

    return { response, result };
  };

  const trySubmitWithOssDirectUpload = async (file: File, recordId: string) => {
    const policyResponse = await fetch("/api/oss/upload-policy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type || getFileTypeFromName(file.name),
        fileSize: file.size
      })
    });
    const policy = await readJsonResponse<OssUploadPolicyResponse>(policyResponse);

    if (!policyResponse.ok || !policy.ok) {
      throw new Error(policy.message || "OSS 直传配置获取失败，请检查 OSS 配置。");
    }

    if (!policy.enabled) {
      return null;
    }

    if (!policy.uploadUrl || !policy.fileUrl || !policy.fields) {
      throw new Error("OSS 直传配置不完整，请检查 .env.local。");
    }

    const uploadStartedAt = Date.now();
    await sendClientLog("oss_direct_upload_start", {
      fileType: file.type || getFileTypeFromName(file.name),
      fileSize: file.size
    });

    const directUploadElapsedMs = await uploadFileToOssWithProgress(
      {
        uploadUrl: policy.uploadUrl,
        fields: policy.fields
      },
      file,
      recordId,
      uploadStartedAt
    );

    await sendClientLog("oss_direct_upload_done", {
      elapsedMs: directUploadElapsedMs,
      fileType: file.type || getFileTypeFromName(file.name),
      fileSize: file.size,
      progress: 100,
      message: "ok"
    });

    const transcribeFormData = new FormData();
    transcribeFormData.append("audioUrl", policy.fileUrl);
    transcribeFormData.append("fileName", file.name);
    transcribeFormData.append("fileSize", String(file.size));
    transcribeFormData.append("fileType", file.type || getFileTypeFromName(file.name));
    transcribeFormData.append("directUploadElapsedMs", String(directUploadElapsedMs));
    transcribeFormData.append("transcribeMode", "standard");

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: transcribeFormData
    });
    const result = await readJsonResponse<TranscribeResponse>(response);

    return { response, result };
  };

  const uploadFileToOssWithProgress = (
    policy: Required<Pick<OssUploadPolicyResponse, "uploadUrl" | "fields">>,
    file: File,
    recordId: string,
    uploadStartedAt: number
  ) => {
    const fileType = file.type || getFileTypeFromName(file.name);

    return new Promise<number>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const ossFormData = new FormData();
      let settled = false;
      let lastLoaded = 0;
      let latestProgress = 0;
      let lastProgressAt = Date.now();
      let lastLoggedProgress = -10;
      let slowNoticeShown = false;

      Object.entries(policy.fields).forEach(([key, value]) => {
        ossFormData.append(key, value);
      });
      ossFormData.append("file", file, file.name);

      const clearTimers = () => {
        window.clearInterval(stallTimer);
        window.clearInterval(slowNoticeTimer);
      };

      const failOnce = (message: string) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimers();
        uploadXhrRefs.current.delete(recordId);
        reject(new Error(message));
      };

      const stallTimer = window.setInterval(() => {
        if (settled || Date.now() - lastProgressAt < ossNoProgressTimeoutMs) {
          return;
        }

        const message = "上传可能已卡住，请检查网络后重试，或更换网络。";
        abortReasonsRef.current.set(recordId, "stall");
        updateRecordById(recordId, {
          status: "失败",
          taskStatus: "failed",
          uploadNotice: message,
          errorMessage: message,
          transcript: `${message}\n\n可以重新选择这段录音后再试一次。`
        });
        void sendClientLog("oss_direct_upload_stalled", {
          elapsedMs: Date.now() - uploadStartedAt,
          fileType,
          fileSize: file.size,
          progress: latestProgress,
          loaded: lastLoaded
        });
        xhr.abort();
        failOnce(message);
      }, 5000);

      const slowNoticeTimer = window.setInterval(() => {
        if (settled || slowNoticeShown || Date.now() - uploadStartedAt < ossSlowNoticeAfterMs) {
          return;
        }

        slowNoticeShown = true;
        updateRecordById(recordId, {
          uploadNotice: "当前网络较慢，请耐心等待。",
          transcript: "当前网络较慢，请耐心等待。\n\n任务提交成功后，可稍后在历史记录中查看结果。"
        });
      }, 5000);

      uploadXhrRefs.current.set(recordId, xhr);
      abortReasonsRef.current.delete(recordId);

      xhr.upload.onprogress = (event) => {
        if (settled || !event.lengthComputable || event.loaded <= lastLoaded) {
          return;
        }

        lastLoaded = event.loaded;
        lastProgressAt = Date.now();
        latestProgress = Math.min(100, Math.round((event.loaded / event.total) * 100));
        updateRecordById(recordId, {
          uploadProgress: latestProgress,
          uploadNotice: `正在上传音频，已上传 ${latestProgress}%。`
        });

        if (latestProgress >= lastLoggedProgress + 10 || latestProgress === 100) {
          lastLoggedProgress = latestProgress;
          void sendClientLog("oss_direct_upload_progress", {
            elapsedMs: Date.now() - uploadStartedAt,
            fileType,
            fileSize: file.size,
            progress: latestProgress,
            loaded: event.loaded,
            total: event.total
          });
        }
      };

      xhr.onload = () => {
        if (settled) {
          return;
        }

        const elapsedMs = Date.now() - uploadStartedAt;

        if (xhr.status >= 200 && xhr.status < 300) {
          settled = true;
          clearTimers();
          uploadXhrRefs.current.delete(recordId);
          updateRecordById(recordId, {
            uploadProgress: 100,
            uploadNotice: "上传完成，正在提交转写任务。",
            status: "转写中",
            taskStatus: "transcribing",
            transcript: `${transcribingTitle}\n\n${transcribingDescription}`
          });
          resolve(elapsedMs);
          return;
        }

        const ossErrorMessage = getFriendlyOssError(xhr.responseText);

        void sendClientLog("oss_direct_upload_failed", {
          elapsedMs,
          fileType,
          fileSize: file.size,
          progress: latestProgress,
          message: getOssErrorCode(xhr.responseText) ?? `status_${xhr.status}`
        });
        failOnce(ossErrorMessage);
      };

      xhr.onerror = () => {
        failOnce("OSS 直传失败，请检查网络、Bucket CORS 或 OSS 配置后重试。");
      };

      xhr.onabort = () => {
        if (settled) {
          return;
        }

        const reason = abortReasonsRef.current.get(recordId);

        if (reason === "user") {
          void sendClientLog("oss_direct_upload_aborted", {
            elapsedMs: Date.now() - uploadStartedAt,
            fileType,
            fileSize: file.size,
            progress: latestProgress,
            loaded: lastLoaded,
            message: "user_cancelled"
          });
          failOnce("上传已取消，可以重新选择录音。");
          return;
        }

        if (reason === "stall") {
          failOnce("上传可能已卡住，请检查网络后重试，或更换网络。");
          return;
        }

        failOnce("上传已中断，请检查网络后重试。");
      };

      xhr.open("POST", policy.uploadUrl);
      xhr.send(ossFormData);
    });
  };

  const pollTranscriptionResult = async (transcriptId: string, recordId: string) => {
    const pollStartedAt = Date.now();

    for (let attempt = 1; attempt <= transcribeMaxPollAttempts; attempt += 1) {
      await wait(transcribePollIntervalMs);

      const response = await fetch(`/api/transcribe/${transcriptId}?mode=standard`);
      const result = await readJsonResponse<TranscribeResponse>(response);
      const elapsedMs = result.elapsedMs ?? Date.now() - pollStartedAt;

      if (!response.ok || !result.ok) {
        const message = getFriendlyTranscribeError(result.message);
        markRecordFailed(recordId, message);
        return null;
      }

      if (result.status === "completed" && result.transcript) {
        const elapsedText = result.elapsedMs ? formatElapsedTime(result.elapsedMs) : "";

        updateRecordById(recordId, {
          status: "生成纪要中",
          taskStatus: "summarizing",
          transcript: result.transcript,
          transcriptSegments: result.segments ?? [],
          transcribeElapsedText: elapsedText,
          summary: "正在生成会议纪要...",
          outline: "正在生成会议大纲...",
          actionItems: []
        });
        return {
          transcript: result.transcript,
          segments: result.segments ?? []
        };
      }

      const isLongProcessing = elapsedMs >= longAudioNoticeAfterMs;

      void sendClientLog("transcribe_polling_status", {
        elapsedMs,
        message: result.rawStatus ?? result.status ?? "processing"
      });

      updateRecordById(recordId, {
        status: isLongProcessing ? "转写中" : "转写中",
        taskStatus: "transcribing",
        transcript: `${transcribingTitle}\n\n${isLongProcessing ? longTranscribingDescription : transcribingDescription}`
      });
    }

    updateRecordById(recordId, {
      status: "转写中",
      taskStatus: "still_processing",
      transcript: "转写任务仍在处理中，请稍后回来查看结果。\n\n系统会保留当前会议记录，后续可以在左侧历史记录中重新打开查看。"
    });
    return null;
  };

  const generateReportForRecord = async (recordId: string, transcript: string) => {
    updateRecordById(recordId, {
      status: "生成纪要中",
      taskStatus: "summarizing",
      summary: "正在生成会议纪要...",
      outline: "正在生成会议大纲...",
      actionItems: []
    });

    try {
      const response = await fetch("/api/generate-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ transcript })
      });
      const result = (await response.json()) as GenerateReportResponse;

      if (!response.ok || !result.ok) {
        markRecordFailed(recordId, getFriendlyGenerateError(result.message));
        return;
      }

      updateRecordById(recordId, {
        status: "已完成",
        taskStatus: "completed",
        summary: result.summary || "未生成会议纪要。",
        outline: result.outline || "未生成会议大纲。",
        actionItems: normalizeActionItems(result.actionItems)
      });
      showNotice("会议纪要和会议大纲已生成");
    } catch {
      markRecordFailed(recordId, "会议纪要生成失败，请稍后重试。");
    }
  };

  const handleGenerateReport = async () => {
    const transcript = activeRecord.transcript.trim();

    if (!transcript || !hasUsableTranscript) {
      showNotice("请先等待转写完成");
      return;
    }

    setGenerateStatus("正在生成会议纪要和会议大纲，请稍候。");
    await generateReportForRecord(activeRecord.id, transcript);
    setGenerateStatus("");
  };

  const markRecordFailed = (recordId: string, message: string) => {
    updateRecordById(recordId, {
      status: "失败",
      taskStatus: "failed",
      errorMessage: message,
      uploadNotice: message,
      transcript: `${message}\n\n可以重新选择这段录音后再试一次。`,
      transcriptSegments: []
    });
  };

  const abortUpload = (recordId: string) => {
    const xhr = uploadXhrRefs.current.get(recordId);

    if (!xhr) {
      return;
    }

    abortReasonsRef.current.set(recordId, "user");
    xhr.abort();
  };

  const jumpToTimestamp = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds;
      void audioRef.current.play();
    }
  };

  const handleExportWord = async () => {
    if (!canExportRecord(activeRecord)) {
      showNotice("当前记录暂无可导出的内容");
      return;
    }

    setIsExportingWord(true);

    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } =
        await import("docx");
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                heading: HeadingLevel.TITLE,
                children: [new TextRun(activeRecord.title)]
              }),
              ...createWordSection("会议纪要", activeRecord.summary, { Paragraph, TextRun, HeadingLevel }),
              ...createWordSection("会议大纲", activeRecord.outline, { Paragraph, TextRun, HeadingLevel }),
              ...createWordActionItemsTable(activeRecord.actionItems, {
                Paragraph,
                TextRun,
                HeadingLevel,
                Table,
                TableRow,
                TableCell,
                WidthType
              })
            ]
          }
        ]
      });
      const blob = await Packer.toBlob(doc);
      await saveBlobWithPicker(
        blob,
        `${sanitizeDownloadFileName(activeRecord.title)}-会议纪要.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      showNotice("Word 已导出");
    } catch (error) {
      showNotice(isSaveCancelled(error) ? "已取消导出" : "Word 导出失败，请稍后重试");
    } finally {
      setIsExportingWord(false);
    }
  };

  const handleExportPdf = async () => {
    if (!canExportRecord(activeRecord)) {
      showNotice("当前记录暂无可导出的内容");
      return;
    }

    setIsExportingPdf(true);

    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const exportNode = createPdfExportNode(activeRecord);

      document.body.appendChild(exportNode);
      const canvas = await html2canvas(exportNode, {
        scale: 2,
        backgroundColor: "#ffffff"
      });
      document.body.removeChild(exportNode);

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const imageWidth = pageWidth - margin * 2;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;
      let remainingHeight = imageHeight;
      let position = margin;

      const imageData = canvas.toDataURL("image/png");
      pdf.addImage(imageData, "PNG", margin, position, imageWidth, imageHeight);
      remainingHeight -= pageHeight - margin * 2;

      while (remainingHeight > 0) {
        position = remainingHeight - imageHeight + margin;
        pdf.addPage();
        pdf.addImage(imageData, "PNG", margin, position, imageWidth, imageHeight);
        remainingHeight -= pageHeight - margin * 2;
      }

      await saveBlobWithPicker(
        pdf.output("blob"),
        `${sanitizeDownloadFileName(activeRecord.title)}-会议纪要.pdf`,
        "application/pdf"
      );
      showNotice("PDF 已导出");
    } catch (error) {
      showNotice(isSaveCancelled(error) ? "已取消导出" : "PDF 导出失败，请稍后重试");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportCsv = async () => {
    if (activeRecord.actionItems.length === 0) {
      showNotice("当前记录暂无行动项可导出");
      return;
    }

    setIsExportingCsv(true);

    try {
      const blob = new Blob([`\uFEFF${buildActionItemsCsv(activeRecord.actionItems)}`], {
        type: "text/csv;charset=utf-8"
      });

      await saveBlobWithPicker(
        blob,
        `${sanitizeDownloadFileName(activeRecord.title)}-行动项矩阵.csv`,
        "text/csv"
      );
      showNotice("CSV 已导出");
    } catch (error) {
      showNotice(isSaveCancelled(error) ? "已取消导出" : "CSV 导出失败，请稍后重试");
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handleExportExcel = async () => {
    if (activeRecord.actionItems.length === 0) {
      showNotice("当前记录暂无行动项可导出");
      return;
    }

    setIsExportingExcel(true);

    try {
      const blob = new Blob([buildActionItemsExcelHtml(activeRecord)], {
        type: "application/vnd.ms-excel;charset=utf-8"
      });

      await saveBlobWithPicker(
        blob,
        `${sanitizeDownloadFileName(activeRecord.title)}-行动项矩阵.xls`,
        "application/vnd.ms-excel"
      );
      showNotice("Excel 已导出");
    } catch (error) {
      showNotice(isSaveCancelled(error) ? "已取消导出" : "Excel 导出失败，请稍后重试");
    } finally {
      setIsExportingExcel(false);
    }
  };

  const copyText = async (label: string, value: string) => {
    if (!value.trim()) {
      showNotice(`暂无${label}可复制`);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      showNotice(`已复制${label}`);
    } catch {
      showNotice("复制失败，请手动选择文本复制");
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-800">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-slate-800 bg-[#1a1d21] text-slate-100 lg:w-[265px] lg:border-b-0 lg:border-r">
          <div className="px-5 py-6">
            <h1 className="text-xl font-semibold tracking-normal text-white">AI 会议助手</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">本地会议录音转写与纪要生成工具</p>
          </div>

          <nav className="px-3 pb-5">
            <button
              className={`${buttonBase} mb-3 w-full border-slate-700 bg-slate-800 text-slate-100 shadow-sm hover:bg-slate-700`}
              type="button"
              onClick={openNewMeeting}
            >
              ＋ 新建会议
            </button>
            <button
              className="mb-5 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white"
              type="button"
              onClick={() => setShowSettings(true)}
            >
              系统配置
            </button>

            <div className="mb-3 flex items-center justify-between px-2">
              <div>
                <p className="text-sm font-medium text-slate-200">最近会议</p>
                <p className="mt-1 text-xs text-slate-500">默认保留 {recordRetentionDays} 天</p>
              </div>
              <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-400">{records.length} 条</span>
            </div>

            <div className="mb-3 flex gap-2 px-2">
              <button
                className={`${buttonBase} flex-1 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`}
                type="button"
                disabled={selectedRecordIds.length === 0}
                onClick={deleteSelectedRecords}
              >
                删除所选
              </button>
              <button
                className={`${buttonBase} border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`}
                type="button"
                disabled={!hasAnyRecord}
                onClick={() =>
                  setSelectedRecordIds((currentIds) => (currentIds.length === records.length ? [] : records.map((record) => record.id)))
                }
              >
                {selectedRecordIds.length === records.length && records.length > 0 ? "取消全选" : "全选"}
              </button>
            </div>

            <div className="max-h-[calc(100vh-250px)] space-y-2 overflow-y-auto pr-1">
              {records.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/60 px-3 py-4 text-sm leading-6 text-slate-400">
                  暂无历史记录。选择录音后，每个音频会自动生成一条记录。
                </div>
              ) : null}

              {records.map((record) => {
                const isActive = record.id === activeRecord.id;

                return (
                  <div
                    key={record.id}
                    className={`rounded-xl border px-3 py-3 transition ${
                      isActive
                        ? "border-blue-500/70 bg-slate-800 text-white shadow-sm"
                        : "border-transparent bg-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex gap-2">
                      <input
                        className="mt-1 h-4 w-4 shrink-0"
                        type="checkbox"
                        checked={selectedRecordIds.includes(record.id)}
                        onChange={() => toggleSelectedRecord(record.id)}
                      />
                      <button className="min-w-0 flex-1 text-left" type="button" onClick={() => openRecord(record.id)}>
                        <span className="block truncate text-sm font-medium">{record.title}</span>
                        <span className={`mt-1 block text-xs ${isActive ? "text-slate-400" : "text-slate-500"}`}>
                          {record.date} · {record.duration}
                        </span>
                        {record.audioFileName ? (
                          <span className={`mt-1 block truncate text-xs ${isActive ? "text-slate-400" : "text-slate-500"}`}>
                            {record.audioFileName}
                          </span>
                        ) : null}
                        <span className="mt-2 flex items-center gap-2">
                          <StatusBadge status={record.taskStatus} label={record.status} />
                          {record.taskStatus === "uploading" && typeof record.uploadProgress === "number" ? (
                            <span className={`text-xs ${isActive ? "text-slate-400" : "text-slate-400"}`}>{record.uploadProgress}%</span>
                          ) : null}
                        </span>
                      </button>
                    </div>
                    <div className="mt-3 flex gap-2 pl-6">
                      <button
                        className={`text-xs ${isActive ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-white"}`}
                        type="button"
                        onClick={() => renameRecord(record.id)}
                      >
                        重命名
                      </button>
                      <button
                        className={`text-xs ${isActive ? "text-slate-400 hover:text-red-300" : "text-slate-500 hover:text-red-300"}`}
                        type="button"
                        onClick={() => deleteRecord(record.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </nav>
        </aside>

        <section className="flex-1 px-4 py-5 sm:px-7 lg:px-8">
          <div className="mx-auto max-w-7xl">
            {showSettings ? (
              <SettingsPanel
                currentOrigin={currentOrigin}
                settings={settings}
                settingsStatus={settingsStatus}
                onClose={() => {
                  setShowSettings(false);
                }}
                onSave={async (payload) => {
                  setSettingsStatus("正在保存…");
                  try {
                    const res = await fetch("/api/settings", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload)
                    });
                    const result = (await res.json()) as { ok: boolean; message?: string; config?: PublicRuntimeConfig };
                    if (result.ok && result.config) {
                      setSettings(result.config);
                      setSettingsStatus("✓ " + (result.message || "配置已保存。"));
                    } else {
                      setSettingsStatus("保存失败：" + (result.message || "未知错误"));
                    }
                  } catch {
                    setSettingsStatus("保存失败：网络错误");
                  }
                }}
              />
            ) : (
              <>
            <header className="mb-5 border-b border-slate-200 pb-5 lg:flex lg:items-end lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-500">当前会议</p>
                  {activeRecord.id !== emptyRecord.id ? <StatusBadge status={activeRecord.taskStatus} label={activeRecord.status} /> : null}
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">{activeRecord.title}</h2>
                  <p className="mt-2 max-w-2xl text-sm text-slate-500">
                  {activeRecord.id === emptyRecord.id
                    ? "选择一个或多个会议录音后，系统会自动生成转写文本、会议纪要和会议大纲。"
                    : `${activeRecord.date} · ${activeRecord.duration} · ${activeRecord.status}`}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 lg:mt-0">
                <button
                  className={`${buttonBase} border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}
                  type="button"
                  disabled={!hasUsableTranscript}
                  onClick={handleGenerateReport}
                >
                  重新生成纪要
                </button>
                <button
                  className={`${buttonBase} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
                  type="button"
                  disabled={
                    !activeRecord.transcript.trim() &&
                    !activeRecord.summary.trim() &&
                    !activeRecord.outline.trim() &&
                    activeRecord.actionItems.length === 0
                  }
                  onClick={() =>
                    copyText(
                      "全部内容",
                      `# 转写文本\n${activeRecord.transcript}\n\n# 会议纪要\n${activeRecord.summary}\n\n# 会议大纲\n${activeRecord.outline}\n\n# 行动项矩阵\n${formatActionItemsForCopy(activeRecord.actionItems)}`
                    )
                  }
                >
                  复制全部
                </button>
              </div>
            </header>

            {notice ? (
              <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
                {notice}
              </div>
            ) : null}

            {generateStatus ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
                {generateStatus}
              </div>
            ) : null}

            <WorkflowProgress
              taskStatus={activeRecord.taskStatus}
              hasRecord={activeRecord.id !== emptyRecord.id}
              isSummarizingFailed={
                activeRecord.taskStatus === "failed" &&
                (activeRecord.summary === "正在生成会议纪要..." || Boolean(activeRecord.transcriptId))
              }
            />

            <section
              className={`mb-5 rounded-xl border border-dashed bg-white px-5 py-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition ${
                isDraggingAudio ? "border-slate-950 ring-2 ring-slate-200" : "border-slate-300"
              }`}
              onDragOver={handleAudioDragOver}
              onDragLeave={handleAudioDragLeave}
              onDrop={handleAudioDrop}
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-base font-semibold tracking-normal text-slate-950">上传会议录音</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    支持格式：mp3、wav、m4a、mp4。本地处理，音频不上传云端。
                  </p>
                </div>
                <label className={`${buttonBase} cursor-pointer border-slate-950 bg-slate-950 text-white hover:bg-slate-800`}>
                  选择音频文件
                  <input
                    className="sr-only"
                    type="file"
                    multiple
                    accept=".mp3,.wav,.m4a,.mp4,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,video/mp4"
                    onChange={handleAudioFileChange}
                  />
                </label>
              </div>
              {activeRecord.id !== emptyRecord.id ? <TaskInfoPanel record={activeRecord} /> : null}
            </section>

            <div className="space-y-5">
              <EditablePanel
                label="转写文本"
                helper=""
                minHeight="min-h-[360px]"
                value={activeRecord.transcript}
                placeholder="等待上传录音后生成转写文本"
                copyLabel="复制"
                onCopy={() => copyText("转写文本", activeRecord.transcript)}
                onChange={(value) => updateRecord("transcript", value)}
              />

              <EditablePanel
                label="会议纪要"
                helper="根据转写内容整理出的结构化会议摘要，可继续编辑。"
                minHeight="min-h-[320px]"
                value={activeRecord.summary}
                placeholder="等待生成会议纪要"
                copyLabel="复制"
                onCopy={() => copyText("会议纪要", activeRecord.summary)}
                onChange={(value) => updateRecord("summary", value)}
              />

              <ActionItemsPanel
                items={activeRecord.actionItems}
                isLoading={activeRecord.taskStatus === "summarizing"}
                onCopy={() => copyText("行动项矩阵", formatActionItemsForCopy(activeRecord.actionItems))}
                onTimestampClick={currentAudioUrl ? jumpToTimestamp : undefined}
              />

              <EditablePanel
                label="会议大纲"
                helper="用于培训展示或汇报材料的会议大纲，可继续编辑。"
                minHeight="min-h-[320px]"
                value={activeRecord.outline}
                placeholder="等待生成会议大纲"
                copyLabel="复制"
                onCopy={() => copyText("会议大纲", activeRecord.outline)}
                onChange={(value) => updateRecord("outline", value)}
              />
            </div>
            <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-5">
              <button
                className={`${buttonBase} border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}
                type="button"
                disabled={isExportingCsv || activeRecord.actionItems.length === 0}
                onClick={handleExportCsv}
              >
                {isExportingCsv ? "导出中..." : "导出 CSV"}
              </button>
              <button
                className={`${buttonBase} border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}
                type="button"
                disabled={isExportingExcel || activeRecord.actionItems.length === 0}
                onClick={handleExportExcel}
              >
                {isExportingExcel ? "导出中..." : "导出 Excel"}
              </button>
              <button
                className={`${buttonBase} border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}
                type="button"
                disabled={isExportingPdf || !canExportRecord(activeRecord)}
                onClick={handleExportPdf}
              >
                {isExportingPdf ? "导出中..." : "导出 PDF"}
              </button>
              <button
                className={`${buttonBase} border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}
                type="button"
                disabled={isExportingWord || !canExportRecord(activeRecord)}
                onClick={handleExportWord}
              >
                {isExportingWord ? "导出中..." : "导出 Word"}
              </button>
            </footer>
              </>
            )}
          </div>
        </section>
      </div>
      {currentAudioUrl ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          ref={audioRef}
          src={currentAudioUrl}
          onPlay={() => setIsAudioPlaying(true)}
          onPause={() => setIsAudioPlaying(false)}
          onEnded={() => setIsAudioPlaying(false)}
          onTimeUpdate={() => {
            if (audioRef.current) setAudioCurrentTime(audioRef.current.currentTime);
          }}
          onLoadedMetadata={() => {
            if (audioRef.current) setAudioDuration(audioRef.current.duration);
          }}
          style={{ display: "none" }}
        />
      ) : null}

      {currentAudioUrl && (isAudioPlaying || audioCurrentTime > 0) ? (
        <FloatingAudioPlayer
          isPlaying={isAudioPlaying}
          currentTime={audioCurrentTime}
          duration={audioDuration}
          onPlayPause={() => {
            if (!audioRef.current) return;
            if (isAudioPlaying) {
              audioRef.current.pause();
            } else {
              void audioRef.current.play();
            }
          }}
          onSeek={(seconds) => {
            if (audioRef.current) audioRef.current.currentTime = seconds;
          }}
          onClose={() => {
            if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
            }
            setIsAudioPlaying(false);
            setAudioCurrentTime(0);
          }}
        />
      ) : null}
    </main>
  );
}

function createRecordFromFile(recordId: string, title: string, file: File): MeetingRecord {
  const now = new Date().toISOString();

  return {
    id: recordId,
    title,
    createdAt: now,
    updatedAt: now,
    date: "刚刚",
    duration: "待识别",
    status: "上传中",
    taskStatus: "queued",
    transcript: "任务已创建，等待上传。\n\n系统会自动完成上传、转写、会议纪要和会议大纲生成。",
    summary: "等待生成会议纪要",
    outline: "等待生成会议大纲",
    actionItems: [],
    audioFileName: file.name,
    audioFileSize: formatFileSize(file.size),
    audioFileType: file.type || getFileTypeFromName(file.name),
    audioFileSizeBytes: file.size,
    uploadProgress: 0,
    uploadNotice: "等待上传",
    transcriptSegments: []
  };
}

function SettingsPanel({
  currentOrigin,
  settings,
  settingsStatus,
  onClose,
  onSave
}: {
  currentOrigin: string;
  settings: PublicRuntimeConfig | null;
  settingsStatus: string;
  onClose: () => void;
  onSave: (payload: Record<string, string>) => Promise<void>;
}) {
  const [dashscopeApiKey, setDashscopeApiKey] = useState("");
  const [hfToken, setHfToken] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({ dashscopeApiKey, hfToken });
    setSaving(false);
    setDashscopeApiKey("");
    setHfToken("");
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">系统设置</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">API 配置</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            配置 AI 服务所需的 API Key。留空则沿用已保存的值或环境变量。
          </p>
        </div>
        <button
          className={`${buttonBase} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
          type="button"
          onClick={onClose}
        >
          返回主界面
        </button>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {/* Aliyun / DashScope */}
        <div>
          <label className="block text-sm font-medium text-slate-800" htmlFor="dashscope-key">
            阿里云 API Key
            <span className="ml-2 text-xs font-normal text-slate-500">（用于会议摘要 · DashScope / 通义）</span>
          </label>
          {settings?.dashscopeApiKeyConfigured ? (
            <p className="mt-1 text-xs text-emerald-600">
              ✓ 已配置{settings.dashscopeApiKeySaved ? "（已保存）" : "（来自环境变量）"}
            </p>
          ) : (
            <p className="mt-1 text-xs text-amber-600">⚠ 未配置，摘要功能不可用</p>
          )}
          <input
            id="dashscope-key"
            type="password"
            autoComplete="off"
            placeholder={settings?.dashscopeApiKeyConfigured ? "已配置，输入新值可覆盖" : "sk-xxxxxxxxxxxxxxxx"}
            value={dashscopeApiKey}
            onChange={(e) => setDashscopeApiKey(e.target.value)}
            className="mt-2 block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
          />
        </div>

        {/* HuggingFace Token */}
        <div>
          <label className="block text-sm font-medium text-slate-800" htmlFor="hf-token">
            HuggingFace Token
            <span className="ml-2 text-xs font-normal text-slate-500">（用于说话人识别 · pyannote 模型）</span>
          </label>
          {settings?.hfTokenConfigured ? (
            <p className="mt-1 text-xs text-emerald-600">
              ✓ 已配置{settings.hfTokenSaved ? "（已保存）" : "（来自环境变量）"}
            </p>
          ) : (
            <p className="mt-1 text-xs text-amber-600">⚠ 未配置，说话人识别可能受限</p>
          )}
          <input
            id="hf-token"
            type="password"
            autoComplete="off"
            placeholder={settings?.hfTokenConfigured ? "已配置，输入新值可覆盖" : "hf_xxxxxxxxxxxxxxxx"}
            value={hfToken}
            onChange={(e) => setHfToken(e.target.value)}
            className="mt-2 block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      {settingsStatus ? (
        <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${
          settingsStatus.startsWith("✓")
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : settingsStatus.startsWith("正在")
            ? "border-slate-200 bg-white text-slate-600"
            : "border-red-200 bg-red-50 text-red-700"
        }`}>
          {settingsStatus}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          className={`${buttonBase} border-slate-950 bg-slate-950 text-white hover:bg-slate-800 disabled:opacity-50`}
          type="button"
          disabled={saving || (!dashscopeApiKey && !hfToken)}
          onClick={handleSave}
        >
          {saving ? "保存中…" : "保存配置"}
        </button>
        <button
          className={`${buttonBase} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
          type="button"
          onClick={onClose}
        >
          返回主界面
        </button>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        <p className="font-medium text-slate-950">运行说明</p>
        <p className="mt-1">配置保存后立即生效，不需要重启应用。</p>
        <p className="mt-1">当前访问地址：<span className="font-medium text-slate-950">{currentOrigin || "—"}</span></p>
      </div>
    </section>
  );
}

function TaskInfoPanel({ record }: { record: MeetingRecord }) {
  return (
    <dl className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-slate-500">音频文件名</dt>
        <dd className="mt-1 break-all font-medium text-slate-800">{record.audioFileName || "未选择"}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">文件大小</dt>
        <dd className="mt-1 font-medium text-slate-800">{record.audioFileSize || "未明确"}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">文件类型</dt>
        <dd className="mt-1 font-medium text-slate-800">{record.audioFileType || "未明确"}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">处理状态</dt>
        <dd className="mt-1">
          <StatusBadge status={record.taskStatus} label={record.status} />
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">创建时间</dt>
        <dd className="mt-1 font-medium text-slate-800">{formatDateTime(record.createdAt)}</dd>
      </div>
      {record.uploadNotice && ["transcribing", "still_processing", "summarizing"].includes(record.taskStatus) ? (
        <div className="sm:col-span-2">
          <p className="text-xs leading-5 text-slate-600">{record.uploadNotice}</p>
        </div>
      ) : null}
      {record.errorMessage ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
          {record.errorMessage}
        </div>
      ) : null}
    </dl>
  );
}

function StatusBadge({ status, label }: { status: TaskStatus; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${getStatusBadgeClass(status)}`}>
      {label}
    </span>
  );
}

function getStatusBadgeClass(status: TaskStatus) {
  if (status === "completed") {
    return "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200";
  }

  if (status === "failed") {
    return "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200";
  }

  if (status === "uploading" || status === "transcribing" || status === "summarizing" || status === "still_processing") {
    return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  }

  return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200";
}

type WordExportTools = {
  Paragraph: new (options?: any) => any;
  TextRun: new (options?: any) => any;
  HeadingLevel: {
    HEADING_1: string;
  };
};

type WordActionItemsTableTools = WordExportTools & {
  Table: new (options?: any) => any;
  TableRow: new (options?: any) => any;
  TableCell: new (options?: any) => any;
  WidthType: {
    PERCENTAGE: string;
  };
};

function createWordSection(title: string, content: string, tools: WordExportTools) {
  const { Paragraph, TextRun, HeadingLevel } = tools;
  const text = content.trim() || "暂无内容";

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(title)]
    }),
    ...text.split("\n").map(
      (line) =>
        new Paragraph({
          children: [new TextRun(line || " ")]
        })
    )
  ];
}

function createWordActionItemsTable(items: ActionItem[], tools: WordActionItemsTableTools) {
  const { Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = tools;
  const headers = ["议题", "责任人", "预期结果", "截止时间", "溯源时间戳"];

  if (items.length === 0) {
    return createWordSection("行动项矩阵", "暂无内容", { Paragraph, TextRun, HeadingLevel });
  }

  const createCell = (text: string, isHeader = false) =>
    new TableCell({
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text,
              bold: isHeader
            })
          ]
        })
      ]
    });

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun("行动项矩阵")]
    }),
    new Table({
      width: {
        size: 100,
        type: WidthType.PERCENTAGE
      },
      rows: [
        new TableRow({
          children: headers.map((header) => createCell(header, true))
        }),
        ...items.map(
          (item) =>
            new TableRow({
              children: [
                createCell(item.topic),
                createCell(item.owner),
                createCell(item.expectedResult),
                createCell(item.deadline),
                createCell(item.sourceTimestamp)
              ]
            })
        )
      ]
    })
  ];
}

function createPdfExportNode(record: MeetingRecord) {
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.width = "794px";
  container.style.boxSizing = "border-box";
  container.style.padding = "48px";
  container.style.background = "#ffffff";
  container.style.color = "#111111";
  container.style.fontFamily =
    'Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  container.style.fontSize = "16px";
  container.style.lineHeight = "1.75";

  const title = document.createElement("h1");
  title.textContent = record.title;
  title.style.fontSize = "28px";
  title.style.margin = "0 0 24px";
  title.style.lineHeight = "1.35";
  container.appendChild(title);

  appendPdfSection(container, "会议纪要", record.summary);
  appendPdfSection(container, "会议大纲", record.outline);
  appendPdfActionItemsTable(container, record.actionItems);

  return container;
}

function appendPdfSection(container: HTMLDivElement, title: string, content: string) {
  const sectionTitle = document.createElement("h2");
  sectionTitle.textContent = title;
  sectionTitle.style.fontSize = "20px";
  sectionTitle.style.margin = "24px 0 8px";
  sectionTitle.style.lineHeight = "1.4";
  container.appendChild(sectionTitle);

  const body = document.createElement("div");
  body.textContent = content.trim() || "暂无内容";
  body.style.whiteSpace = "pre-wrap";
  body.style.wordBreak = "break-word";
  container.appendChild(body);
}

function appendPdfActionItemsTable(container: HTMLDivElement, items: ActionItem[]) {
  const sectionTitle = document.createElement("h2");
  sectionTitle.textContent = "行动项矩阵";
  sectionTitle.style.fontSize = "20px";
  sectionTitle.style.margin = "24px 0 8px";
  sectionTitle.style.lineHeight = "1.4";
  container.appendChild(sectionTitle);

  if (items.length === 0) {
    const emptyText = document.createElement("div");
    emptyText.textContent = "暂无内容";
    container.appendChild(emptyText);
    return;
  }

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "13px";
  table.style.lineHeight = "1.55";
  table.style.tableLayout = "fixed";

  const headers = ["议题", "责任人", "预期结果", "截止时间", "溯源时间戳"];
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  headers.forEach((header) => {
    const cell = document.createElement("th");
    cell.textContent = header;
    cell.style.border = "1px solid #d9dee8";
    cell.style.background = "#f3f5f8";
    cell.style.padding = "8px";
    cell.style.textAlign = "left";
    cell.style.verticalAlign = "top";
    headerRow.appendChild(cell);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  items.forEach((item) => {
    const row = document.createElement("tr");
    [item.topic, item.owner, item.expectedResult, item.deadline, item.sourceTimestamp].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      cell.style.border = "1px solid #d9dee8";
      cell.style.padding = "8px";
      cell.style.verticalAlign = "top";
      cell.style.wordBreak = "break-word";
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

function canExportRecord(record: MeetingRecord) {
  return Boolean(record.title.trim() && (record.summary.trim() || record.outline.trim() || record.actionItems.length > 0));
}

function sanitizeDownloadFileName(fileName: string) {
  return (fileName || "会议记录").replace(/[\\/:*?"<>|]/g, "_").trim() || "会议记录";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function saveBlobWithPicker(blob: Blob, fileName: string, mimeType: string) {
  const pickerWindow = window as SaveFilePickerWindow;

  if (!pickerWindow.showSaveFilePicker) {
    downloadBlob(blob, fileName);
    return;
  }

  const extension = getFileExtension(fileName);
  const handle = await pickerWindow.showSaveFilePicker({
    suggestedName: fileName,
    types: [
      {
        description: getFilePickerDescription(extension),
        accept: {
          [mimeType]: [extension]
        }
      }
    ]
  });
  const writable = await handle.createWritable();

  await writable.write(blob);
  await writable.close();
}

function getFileExtension(fileName: string) {
  const extension = fileName.match(/\.[^.]+$/)?.[0];

  return extension || ".txt";
}

function getFilePickerDescription(extension: string) {
  if (extension === ".pdf") {
    return "PDF 文件";
  }

  if (extension === ".docx") {
    return "Word 文档";
  }

  if (extension === ".csv") {
    return "CSV 表格";
  }

  if (extension === ".xls") {
    return "Excel 表格";
  }

  return "文件";
}

function isSaveCancelled(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function EditablePanel({
  label,
  helper,
  value,
  minHeight,
  placeholder,
  copyLabel,
  onCopy,
  onChange
}: {
  label: string;
  helper: string;
  value: string;
  minHeight: string;
  placeholder?: string;
  copyLabel?: string;
  onCopy?: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-normal text-slate-950">{label}</h3>
          {helper ? <p className="mt-1 text-sm leading-6 text-slate-500">{helper}</p> : null}
        </div>
        {onCopy ? (
          <button
            className={`${buttonBase} shrink-0 border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50`}
            type="button"
            disabled={!value.trim()}
            onClick={onCopy}
          >
            {copyLabel ?? "复制"}
          </button>
        ) : null}
      </div>
      <textarea
        className={`w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200 ${minHeight}`}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </section>
  );
}

function ActionItemsPanel({
  items,
  isLoading,
  onCopy,
  onTimestampClick
}: {
  items: ActionItem[];
  isLoading: boolean;
  onCopy: () => void;
  onTimestampClick?: (seconds: number) => void;
}) {
  const columns = ["议题", "责任人", "预期结果", "截止时间", "溯源时间戳"];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-normal text-slate-950">行动项矩阵</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            核心亮点，快速查看待办责任、预期结果和溯源时间。
            {onTimestampClick ? <span className="ml-1 text-blue-600">点击时间戳可跳转播放。</span> : null}
          </p>
        </div>
        <button
          className={`${buttonBase} shrink-0 border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50`}
          type="button"
          disabled={items.length === 0}
          onClick={onCopy}
        >
          复制
        </button>
      </div>

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[760px] w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="border-b border-slate-200 px-3 py-3">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {items.map((item, index) => {
                const tsSeconds = parseTimestampToSeconds(item.sourceTimestamp);
                const isClickable = tsSeconds !== null && onTimestampClick != null;
                return (
                  <tr key={`${item.topic}-${index}`} className="align-top">
                    <td className="w-[22%] px-3 py-3 leading-6">{item.topic}</td>
                    <td className="w-[14%] px-3 py-3 leading-6">{item.owner}</td>
                    <td className="w-[30%] px-3 py-3 leading-6">{item.expectedResult}</td>
                    <td className="w-[14%] px-3 py-3 leading-6">{item.deadline}</td>
                    <td className="w-[20%] px-3 py-3 font-mono text-xs leading-6">
                      {isClickable ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 active:scale-95"
                          onClick={() => onTimestampClick(tsSeconds)}
                          title={`跳转到 ${item.sourceTimestamp}`}
                        >
                          <svg className="h-2.5 w-2.5 shrink-0 fill-current" viewBox="0 0 10 10">
                            <polygon points="2,1 9,5 2,9" />
                          </svg>
                          {item.sourceTimestamp}
                        </button>
                      ) : (
                        <span className="text-slate-400">{item.sourceTimestamp}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm leading-6 text-slate-500">
          {isLoading ? "正在生成行动项矩阵..." : "等待生成行动项矩阵"}
        </div>
      )}
    </section>
  );
}

function readLocalRecords(retentionDays: number) {
  try {
    const savedRecords = window.localStorage.getItem(localRecordsStorageKey);

    if (!savedRecords) {
      return [];
    }

    const parsedRecords = JSON.parse(savedRecords) as MeetingRecord[];

    return Array.isArray(parsedRecords)
      ? parsedRecords
          .filter((record) => isRecordRetained(record, retentionDays))
          .map((record) => ({
            ...record,
            actionItems: normalizeActionItems(record.actionItems)
          }))
      : [];
  } catch {
    return [];
  }
}

async function fetchHistoryRecords() {
  const response = await fetch("/api/history");
  const result = (await response.json()) as HistoryResponse;

  if (!response.ok || !result.ok || !Array.isArray(result.records)) {
    return [];
  }

  return result.records.map(fromStoredRecord);
}

async function createHistoryRecord(record: MeetingRecord) {
  await fetch("/api/history", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(toStoredRecord(record))
  });
}

async function updateHistoryRecord(record: MeetingRecord) {
  if (record.id === emptyRecord.id) {
    return;
  }

  await fetch(`/api/history/${encodeURIComponent(record.id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(toStoredRecord(record))
  });
}

async function renameHistoryRecord(recordId: string, title: string) {
  await fetch(`/api/history/${encodeURIComponent(recordId)}/rename`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ title })
  });
}

async function deleteHistoryRecord(recordId: string) {
  await fetch(`/api/history/${encodeURIComponent(recordId)}`, {
    method: "DELETE"
  });
}

async function batchDeleteHistoryRecords(recordIds: string[]) {
  await fetch("/api/history/batch-delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ids: recordIds })
  });
}

function toStoredRecord(record: MeetingRecord): StoredMeetingRecord {
  return {
    id: record.id,
    title: record.title,
    originalFileName: record.audioFileName || "",
    fileSize: record.audioFileSizeBytes,
    fileSizeLabel: record.audioFileSize || "",
    fileType: record.audioFileType || "",
    duration: record.duration || "",
    durationSeconds: record.durationSeconds,
    status: record.taskStatus,
    taskStatus: record.taskStatus,
    transcript: record.transcript || "",
    summary: record.summary || "",
    outline: record.outline || "",
    todos: JSON.stringify(normalizeActionItems(record.actionItems)),
    errorMessage: record.errorMessage || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || new Date().toISOString(),
    transcriptId: record.transcriptId || undefined
  };
}

function fromStoredRecord(record: StoredMeetingRecord): MeetingRecord {
  const createdAt = record.createdAt || new Date().toISOString();

  return {
    id: record.id,
    title: record.title || "未命名会议",
    createdAt,
    updatedAt: record.updatedAt,
    date: formatDateLabel(createdAt),
    duration: record.duration || "待识别",
    status: getDisplayStatus(record.taskStatus || record.status),
    taskStatus: normalizeTaskStatus(record.taskStatus || record.status),
    transcript: record.transcript || "",
    summary: record.summary || "",
    outline: record.outline || "",
    actionItems: parseStoredActionItems(record.todos),
    audioFileName: record.originalFileName || "",
    audioFileSize: record.fileSizeLabel || (record.fileSize ? formatFileSize(record.fileSize) : ""),
    audioFileType: record.fileType || "",
    audioFileSizeBytes: record.fileSize,
    durationSeconds: record.durationSeconds,
    uploadProgress: record.status === "已完成" ? 100 : undefined,
    uploadNotice: "",
    errorMessage: record.errorMessage || "",
    transcriptId: record.transcriptId || undefined
  };
}

function parseStoredActionItems(value: string | undefined) {
  if (!value) {
    return [];
  }

  try {
    return normalizeActionItems(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeActionItem(item))
    .filter((item): item is ActionItem => Boolean(item));
}

function normalizeActionItem(value: unknown): ActionItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const topic = textValue(item.topic) || textValue(item["议题"]);
  const expectedResult = textValue(item.expectedResult) || textValue(item["预期结果"]) || textValue(item.action) || textValue(item["行动项"]);

  return {
    topic: topic || "未明确",
    owner: textValue(item.owner) || textValue(item["责任人"]) || "未分配",
    expectedResult: expectedResult || "未明确",
    deadline: textValue(item.deadline) || textValue(item.dueDate) || textValue(item["截止时间"]) || "TBD",
    sourceTimestamp: textValue(item.sourceTimestamp) || textValue(item["溯源时间戳"]) || textValue(item["来源时间戳"]) || "未明确"
  };
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatActionItemsForCopy(items: ActionItem[]) {
  if (items.length === 0) {
    return "";
  }

  const header = "议题\t责任人\t预期结果\t截止时间\t溯源时间戳";
  const rows = items.map((item) =>
    [item.topic, item.owner, item.expectedResult, item.deadline, item.sourceTimestamp]
      .map((value) => value.replace(/\s+/g, " ").trim())
      .join("\t")
  );

  return [header, ...rows].join("\n");
}

function buildActionItemsCsv(items: ActionItem[]) {
  const rows = [
    ["议题", "责任人", "预期结果", "截止时间", "溯源时间戳"],
    ...items.map((item) => [
      item.topic,
      item.owner,
      item.expectedResult,
      item.deadline,
      item.sourceTimestamp
    ])
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function escapeCsvCell(value: string) {
  const normalizedValue = value.replace(/\r?\n/g, " ").trim();

  return `"${normalizedValue.replace(/"/g, '""')}"`;
}

function buildActionItemsExcelHtml(record: MeetingRecord) {
  const rows = record.actionItems
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.topic)}</td>
          <td>${escapeHtml(item.owner)}</td>
          <td>${escapeHtml(item.expectedResult)}</td>
          <td>${escapeHtml(item.deadline)}</td>
          <td>${escapeHtml(item.sourceTimestamp)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; }
    h1 { font-size: 18px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d9dee8; padding: 8px; vertical-align: top; }
    th { background: #f3f5f8; font-weight: 600; }
  </style>
</head>
<body>
  <h1>${escapeHtml(record.title)} - 行动项矩阵</h1>
  <table>
    <thead>
      <tr>
        <th>议题</th>
        <th>责任人</th>
        <th>预期结果</th>
        <th>截止时间</th>
        <th>溯源时间戳</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeTaskStatus(value: string | undefined): TaskStatus {
  if (
    value === "idle" ||
    value === "queued" ||
    value === "uploading" ||
    value === "transcribing" ||
    value === "summarizing" ||
    value === "completed" ||
    value === "failed" ||
    value === "still_processing"
  ) {
    return value;
  }

  if (value?.includes("上传")) {
    return "uploading";
  }

  if (value?.includes("转写")) {
    return "transcribing";
  }

  if (value?.includes("纪要")) {
    return "summarizing";
  }

  if (value?.includes("完成")) {
    return "completed";
  }

  if (value?.includes("失败")) {
    return "failed";
  }

  return "idle";
}

function getDisplayStatus(value: string | undefined) {
  const status = normalizeTaskStatus(value);

  const labels: Record<TaskStatus, string> = {
    idle: "待处理",
    queued: "待上传",
    uploading: "上传中",
    transcribing: "转写中",
    summarizing: "生成纪要中",
    completed: "已完成",
    failed: "失败",
    still_processing: "转写中"
  };

  return labels[status];
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {
      ok: false,
      message: "服务返回内容异常，请稍后重试。"
    } as T;
  }
}

async function sendClientLog(stage: string, details: Record<string, unknown> = {}) {
  try {
    await fetch("/api/client-log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        stage,
        ...details
      })
    });
  } catch {
    // 日志失败不影响主流程。
  }
}

function isSupportedAudioFile(file: File) {
  const supportedExtensions = [".mp3", ".wav", ".m4a", ".mp4"];
  const supportedMimeTypes = [
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
    "video/mp4"
  ];
  const fileName = file.name.toLowerCase();

  return supportedExtensions.some((extension) => fileName.endsWith(extension)) || supportedMimeTypes.includes(file.type);
}

function isRecordRetained(record: MeetingRecord, retentionDays: number) {
  const createdAt = new Date(record.createdAt).getTime();

  if (!Number.isFinite(createdAt)) {
    return true;
  }

  return Date.now() - createdAt <= retentionDays * 24 * 60 * 60 * 1000;
}

function readAudioDuration(file: File) {
  return new Promise<number | null>((resolve) => {
    const media = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);

    media.preload = "metadata";
    media.onloadedmetadata = () => {
      const duration = Number.isFinite(media.duration) ? media.duration : null;
      URL.revokeObjectURL(objectUrl);
      resolve(duration);
    };
    media.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    media.src = objectUrl;
  });
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }

  return `${Math.max(1, minutes)} 分钟`;
}

function formatElapsedTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} 秒`;
  }

  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "未明确";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  const now = Date.now();

  if (!Number.isFinite(date.getTime())) {
    return "刚刚";
  }

  if (now - date.getTime() < 24 * 60 * 60 * 1000) {
    return "今天";
  }

  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  });
}

function getFriendlyTranscribeError(message?: string) {
  if (message?.includes("API Key") || message?.includes("api key") || message?.includes("密钥")) {
    return "本地识别组件未就绪，请检查本机 Python 和模型环境。";
  }

  if (message?.includes("格式") || message?.includes("format")) {
    return "音频格式暂不支持，请尝试 mp3、wav、m4a 或 mp4 文件。";
  }

  return "转写失败，请重试或检查音频文件。";
}

function getFriendlyGenerateError(message?: string) {
  if (message?.includes("API Key") || message?.includes("api key") || message?.includes("密钥")) {
    return "本地摘要组件未就绪，请检查本机 Python 和模型环境。";
  }

  return "会议纪要生成失败，请稍后重试。";
}

function getFriendlyOssError(responseText?: string) {
  const ossCode = getOssErrorCode(responseText);

  if (ossCode === "UserDisable") {
    return "上传失败：当前上传配置不可用，请检查本机或外部上传设置。";
  }

  if (ossCode === "AccessDenied") {
    return "上传失败：当前上传权限不足，请检查配置。";
  }

  if (ossCode === "NoSuchBucket") {
    return "上传失败：没有找到当前目标位置，请检查配置。";
  }

  return "上传失败，请检查配置或网络后重试。";
}

function getOssErrorCode(responseText?: string) {
  if (!responseText) {
    return null;
  }

  return responseText.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? null;
}

function getFileTypeFromName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (!extension) {
    return "未知音频类型";
  }

  if (extension === "mp4") {
    return "MP4 音频/视频";
  }

  return `${extension.toUpperCase()} 音频`;
}

function parseTimestampToSeconds(timestamp: string): number | null {
  if (!timestamp || timestamp === "未明确" || timestamp === "TBD" || timestamp === "未指定") {
    return null;
  }
  const hhmmss = timestamp.match(/(\d+):(\d{2}):(\d{2})/);
  if (hhmmss) {
    return parseInt(hhmmss[1]) * 3600 + parseInt(hhmmss[2]) * 60 + parseInt(hhmmss[3]);
  }
  const mmss = timestamp.match(/(\d+):(\d{2})/);
  if (mmss) {
    return parseInt(mmss[1]) * 60 + parseInt(mmss[2]);
  }
  return null;
}

const workflowStepDefs = [
  { label: "上传录音" },
  { label: "本地转写" },
  { label: "说话人分离" },
  { label: "文本清洗" },
  { label: "会议摘要" },
  { label: "行动项矩阵" },
  { label: "会议大纲" },
  { label: "导出" },
];

function getWorkflowStepStatus(
  stepIndex: number,
  taskStatus: TaskStatus,
  hasRecord: boolean,
  isSummarizingFailed: boolean
): "idle" | "active" | "done" | "error" {
  if (!hasRecord || taskStatus === "idle") return "idle";

  if (taskStatus === "failed") {
    const failedAt = isSummarizingFailed ? 4 : 1;
    if (stepIndex < failedAt) return "done";
    if (stepIndex === failedAt) return "error";
    return "idle";
  }
  if (taskStatus === "queued" || taskStatus === "uploading") {
    if (stepIndex === 0) return "active";
    return "idle";
  }
  if (taskStatus === "transcribing" || taskStatus === "still_processing") {
    if (stepIndex === 0) return "done";
    if (stepIndex >= 1 && stepIndex <= 3) return "active";
    return "idle";
  }
  if (taskStatus === "summarizing") {
    if (stepIndex <= 3) return "done";
    if (stepIndex >= 4 && stepIndex <= 6) return "active";
    return "idle";
  }
  if (taskStatus === "completed") {
    return "done";
  }
  return "idle";
}

function WorkflowProgress({
  taskStatus,
  hasRecord,
  isSummarizingFailed
}: {
  taskStatus: TaskStatus;
  hasRecord: boolean;
  isSummarizingFailed: boolean;
}) {
  return (
    <div className="mb-5 overflow-x-auto rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
      <div className="flex min-w-max items-center gap-0">
        {workflowStepDefs.map((step, index) => {
          const status = getWorkflowStepStatus(index, taskStatus, hasRecord, isSummarizingFailed);
          return (
            <div key={step.label} className="flex items-center">
              <div
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  status === "done"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : status === "active"
                    ? "border-amber-300 bg-amber-50 text-amber-800 shadow-sm"
                    : status === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-slate-200 bg-slate-50 text-slate-400"
                }`}
              >
                <span className="text-[11px] leading-none">
                  {status === "done" ? "✓" : status === "active" ? "⟳" : status === "error" ? "✕" : "○"}
                </span>
                <span>{step.label}</span>
              </div>
              {index < workflowStepDefs.length - 1 ? (
                <div
                  className={`mx-1 text-xs font-bold ${
                    getWorkflowStepStatus(index, taskStatus, hasRecord, isSummarizingFailed) === "done"
                      ? "text-emerald-400"
                      : "text-slate-300"
                  }`}
                >
                  →
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function FloatingAudioPlayer({
  isPlaying,
  currentTime,
  duration,
  onPlayPause,
  onSeek,
  onClose
}: {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
  onClose: () => void;
}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const progress = Math.min(1, currentTime / safeDuration);

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-all">
      {/* 播放/暂停 */}
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-slate-700 active:scale-95"
        onClick={onPlayPause}
        title={isPlaying ? "暂停" : "播放"}
      >
        {isPlaying ? (
          <svg className="h-3 w-3 fill-current" viewBox="0 0 10 10">
            <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
            <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
          </svg>
        ) : (
          <svg className="h-3 w-3 fill-current" viewBox="0 0 10 10">
            <polygon points="2,1 9,5 2,9" />
          </svg>
        )}
      </button>

      {/* 进度条 + 时间 */}
      <div className="flex flex-col gap-1">
        <input
          type="range"
          min={0}
          max={Math.floor(safeDuration)}
          value={Math.floor(currentTime)}
          step={1}
          className="h-1.5 w-40 cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
          onChange={(e) => onSeek(Number(e.target.value))}
        />
        <div className="flex justify-between font-mono text-[10px] text-slate-400">
          <span>{formatAudioTime(currentTime)}</span>
          <span>{formatAudioTime(Number.isFinite(duration) && duration > 0 ? duration : 0)}</span>
        </div>
      </div>

      {/* 关闭 */}
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        onClick={onClose}
        title="关闭播放器"
      >
        <svg className="h-3 w-3 stroke-current" viewBox="0 0 10 10" strokeWidth="2" fill="none">
          <line x1="1" y1="1" x2="9" y2="9" />
          <line x1="9" y1="1" x2="1" y2="9" />
        </svg>
      </button>

      {/* 进度色块（装饰用） */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-slate-900 transition-all"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}
