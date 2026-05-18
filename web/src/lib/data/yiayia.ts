import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export type YiayiaMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function askYiayia({
  courseId,
  lessonId,
  planId,
  tab,
  pathname,
  messages,
}: {
  courseId?: string;
  lessonId?: string;
  planId?: string;
  tab?: string;
  pathname: string;
  messages: YiayiaMessage[];
}) {
  const callable = httpsCallable(functions, "yiayiaChat");
  const result = await callable({
    courseId: courseId ?? "",
    lessonId: lessonId ?? "",
    planId: planId ?? "",
    tab: tab ?? "",
    pathname,
    messages,
  });
  const data = result.data as { message?: string };
  return data.message ?? "";
}

