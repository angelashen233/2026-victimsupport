import React, { useState } from "react";
import type { Message } from "../types";

type ChatScreenProps = {
  messages: Message[];
  setMessages: (msgs: Message[]) => void;
  waitTimes: any[];
  // ...other props
};

const ChatScreen: React.FC<ChatScreenProps> = ({
  messages,
  setMessages,
  waitTimes,
  // ...other props
}) => {
  const [input, setInput] = useState("");

  const handleSend = () => {
    const userMessage = { author: "user", text: input };
    let newMessages = [...messages, userMessage];

    // Simple keyword-based detection
    const lowerInput = input.toLowerCase();
    if (
      lowerInput.includes("wait time") ||
      lowerInput.includes("waittime") ||
      lowerInput.includes("how long") ||
      lowerInput.includes("hospital")
    ) {
      // Try to find a hospital mentioned in the input
      const found = waitTimes.find((wt) =>
        lowerInput.includes(wt.locationId.toLowerCase())
      );
      if (found) {
        newMessages = [
          ...newMessages,
          {
            author: "ai",
            text: `The current wait time at ${found.locationId} is ${found.waitTimeMinutes} minutes.`,
          },
        ];
      } else {
        newMessages = [
          ...newMessages,
          {
            author: "ai",
            text:
              "Please specify the hospital name to get the current wait time.",
          },
        ];
      }
    }

    setMessages(newMessages);
    setInput("");
  };

  return (
    <div>
      {/* Render messages */}
      <div>
        {messages.map((msg, idx) => (
          <div key={idx}>
            <strong>{msg.author}:</strong> {msg.text}
          </div>
        ))}
      </div>
      {/* Input box */}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type your message..."
      />
      <button onClick={handleSend}>Send</button>
    </div>
  );
};

export default ChatScreen;