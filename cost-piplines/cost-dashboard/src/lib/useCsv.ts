import { useEffect, useState } from "react";
import Papa from "papaparse";

export function useCsv<T = Record<string, any>>(path: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetch(path)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} when loading ${path}`);
        }
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await res.json();
          const items = Array.isArray(json) ? json : json.data || [];
          return items as T[];
        }

        const text = await res.text();
        return new Promise<T[]>((resolve, reject) => {
          Papa.parse<T>(text, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => resolve(results.data),
            error: (err) => reject(err),
          });
        });
      })
      .then((parsedData) => {
        if (!active) return;
        setData(parsedData);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        // Fallback: try direct Papa.parse download if fetch fails
        Papa.parse<T>(path, {
          header: true,
          download: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            if (!active) return;
            setData(results.data);
            setLoading(false);
          },
          error: (parseErr) => {
            if (!active) return;
            setError(err.message || parseErr.message);
            setLoading(false);
          },
        });
      });

    return () => {
      active = false;
    };
  }, [path]);

  return { data, loading, error };
}
