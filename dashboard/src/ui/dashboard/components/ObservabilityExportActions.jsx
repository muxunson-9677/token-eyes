import React, { useState } from "react";
import { Download } from "lucide-react";
import { getObservabilityExport } from "../../../lib/api";
import { copy } from "../../../lib/copy";

function contentType(format) {
  return format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
}

export function ObservabilityExportActions() {
  const [error, setError] = useState(null);
  const [downloadingFormat, setDownloadingFormat] = useState(null);

  const download = async (format) => {
    setDownloadingFormat(format);
    setError(null);
    try {
      const result = await getObservabilityExport({ format });
      const content = typeof result?.content === "string" ? result.content : "";
      const resolvedFormat = result?.format === "csv" ? "csv" : "json";
      const href = URL.createObjectURL(new Blob([content], { type: contentType(resolvedFormat) }));
      const link = document.createElement("a");
      link.href = href;
      link.download = `token-eyes-observability.${resolvedFormat}`;
      link.click();
      URL.revokeObjectURL(href);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setDownloadingFormat(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {["json", "csv"].map((format) => (
          <button
            key={format}
            type="button"
            onClick={() => void download(format)}
            disabled={downloadingFormat !== null}
            className="tt-pressable inline-flex h-10 items-center gap-1.5 rounded-md border border-oai-gray-300 px-3 text-xs font-medium text-oai-gray-700 transition-colors hover:bg-oai-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {copy(`observability.export.${format}`)}
          </button>
        ))}
      </div>
      {error ? <p className="text-xs text-red-500 dark:text-red-400">{copy("observability.export.error")}</p> : null}
    </div>
  );
}
