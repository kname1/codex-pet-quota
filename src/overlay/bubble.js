const five = document.getElementById("five");
const week = document.getElementById("week");
const fiveReset = document.getElementById("fiveReset");
const weekReset = document.getElementById("weekReset");
const root = document.querySelector(".quota-lines");

function formatTime(value) {
  if (!value) return "reset unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  return `${month}.${day} ${time}`;
}

function setLoading() {
  five.textContent = "...";
  week.textContent = "...";
  fiveReset.textContent = "refreshing";
  weekReset.textContent = "refreshing";
}

function setData(data) {
  if (data.animate) {
    root.classList.remove("pop");
    void root.offsetWidth;
    root.classList.add("pop");
  }

  five.textContent = data.fiveHour?.remainingText || "unknown";
  week.textContent = data.weekly?.remainingText || "unknown";
  fiveReset.textContent = formatTime(data.fiveHour?.resetAt);
  weekReset.textContent = formatTime(data.weekly?.resetAt);

  if (data.error) {
    five.textContent = "err";
    week.textContent = "err";
    fiveReset.textContent = "retry";
    weekReset.textContent = "later";
    return;
  }
}

root.addEventListener("click", () => window.quotaBubble.refresh());
window.quotaBubble.onLoading(setLoading);
window.quotaBubble.onData(setData);
setLoading();
