import { useEffect, useState } from "react";
import Papa from "papaparse";

export function useCsv<T = Record<string, any>>(path: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
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
      error: (err) => {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      },
    });
    return () => {
      active = false;
    };
  }, [path]);

  return { data, loading, error };
}
