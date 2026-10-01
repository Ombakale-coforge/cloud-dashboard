import { useEffect, useState } from "react";
import Papa from "papaparse";

export function useCsv<T = Record<string, any>>(path: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    const isAzure = path.includes("/azure");
    const provider = isAzure ? "azure" : "aws";

    // Extract account ID and filename from path
    // e.g. /data/accounts/account-2/mom_change.csv -> account=account-2, file=mom_change
    // e.g. /data/mom_change.csv -> account=account-1, file=mom_change
    let account = "account-1";
    const accountMatch = path.match(/accounts\/([^/]+)/);
    if (accountMatch) {
      account = accountMatch[1];
    }

    const filename = path.split("/").pop()?.replace(/\.csv$/, "") || "";
    const apiUrl = `/api/${provider}/dataset/${filename}?account=${encodeURIComponent(account)}`;

    fetch(apiUrl)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`DB API Error (${res.status})`);
        }
        return res.json();
      })
      .then((jsonData) => {
        if (!active) return;
        if (Array.isArray(jsonData) && jsonData.length > 0) {
          setData(jsonData as T[]);
          setLoading(false);
        } else if (jsonData && typeof jsonData === "object" && !Array.isArray(jsonData)) {
          setData([jsonData] as unknown as T[]);
          setLoading(false);
        } else {
          // Empty DB response -> trigger CSV fallback
          throw new Error("Empty dataset from API");
        }
      })
      .catch((apiErr) => {
        // Fallback to local Papa.parse CSV if backend is unreachable
        if (!active) return;
        console.warn(`[useCsv] API fetch failed for ${path}, falling back to CSV:`, apiErr.message);
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
      });

    return () => {
      active = false;
    };
  }, [path]);

  return { data, loading, error };
}
