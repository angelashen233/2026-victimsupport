import { GoogleGenAI, Type } from "@google/genai";
import type { Message, ReportData, Recipient, UserProfile, Resource } from '../types';
import { MessageAuthor } from "../types";

const reportGenerationSchema = {
    type: Type.OBJECT,
    properties: {
      report: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: "Date and approximate time of the incident. If not specified, state 'Not specified'." },
          location: { type: Type.STRING, description: "The location where the incident occurred. If not specified, state 'Not specified'." },
          involved: { type: Type.STRING, description: "Names or descriptions of any individuals involved, including the user, alleged perpetrator(s), and witnesses. If not specified, state 'Not specified'." },
          description: { type: Type.STRING, description: "A detailed, chronological, and objective account of the events as described by the user. Quote directly where possible for accuracy. If not enough detail is provided, state 'Not specified'." },
          impact: { type: Type.STRING, description: "The emotional, physical, or professional impact on the individual, as described by them. If not specified, state 'Not specified'." }
        },
        required: ["date", "location", "involved", "description", "impact"]
      },
      recipients: {
        type: Type.ARRAY,
        description: "A list of 3-5 potential official or authoritative recipients for this report (e.g., 'Local Police Department', 'Company HR Manager', 'University Title IX Office').",
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "The title or role of the potential recipient (e.g., 'Human Resources Department')." },
            description: { type: Type.STRING, description: "A brief explanation of why this recipient might be appropriate." }
          },
          required: ["name", "description"]
        }
      }
    },
    required: ["report", "recipients"]
};

const resourceGenerationSchema = {
    type: Type.OBJECT,
    properties: {
        resources: {
            type: Type.ARRAY,
            description: "A list of 3-5 relevant local and national support resources based on the conversation.",
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "The name of the organization." },
                    description: { type: Type.STRING, description: "A brief, one-sentence description of what the organization does and why it's relevant." },
                    contact: { type: Type.STRING, description: "The primary contact information, like a website URL or a phone number." }
                },
                required: ["name", "description", "contact"]
            }
        }
    },
    required: ["resources"]
};


export const generateReport = async (ai: GoogleGenAI, messages: Message[], userProfile: UserProfile): Promise<{ report: ReportData; recipients: Recipient[] }> => {
    const chatHistory = messages
        .filter(m => m.author !== MessageAuthor.AI || !m.text.startsWith("Hello. I'm here to listen")) // Filter out initial greeting
        .map(m => `${m.author === MessageAuthor.USER ? 'Person' : 'Assistant'}: ${m.text} ${m.image ? '[User provided an image]' : ''}`)
        .join('\n');

    const prompt = `
User Profile Context:
- Location: ${userProfile.location}
- Gender: ${userProfile.gender}

Based on the following conversation, extract the relevant details and structure them into a formal incident report. The user has given their consent to create this draft. Be objective and stick strictly to the facts provided in the conversation. If a piece of information for a field is missing from the conversation, you must state 'Not specified' for that field. Format the output as a JSON object that matches the provided schema. The report should be professional and suitable for submission to HR, legal counsel, or authorities. Also generate a list of credible or official contacts relevant to the incident's context.\n\nConversation:\n${chatHistory}`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: reportGenerationSchema,
            temperature: 0.1
        }
    });

    const jsonString = response.text;
    try {
        const parsedJson = JSON.parse(jsonString);
        return parsedJson;
    } catch (e) {
        console.error("Failed to parse JSON from Gemini:", jsonString);
        throw new Error("The AI returned an invalid report format. Please try again.");
    }
};

export const generateResources = async (ai: GoogleGenAI, messages: Message[], userProfile: UserProfile): Promise<{ resources: Resource[] }> => {
    const chatHistory = messages
        .filter(m => m.author !== MessageAuthor.AI || !m.text.startsWith("Hello. I'm here to listen"))
        .map(m => `${m.author === MessageAuthor.USER ? 'Person' : 'Assistant'}: ${m.text}`)
        .join('\n');

    // Hardcoded Vancouver resources
    const vancouverResources: Resource[] = [
      {
        name: "VictimLinkBC",
        description: "24/7 crisis support and information for victims of crime, including sexual and domestic violence, in BC.",
        contact: "https://victimlinkbc.ca/"
      },
      {
        name: "Ending Violence BC Services Directory",
        description: "Comprehensive directory of anti-violence services and support organizations in British Columbia.",
        contact: "https://endingviolence.org/services-directory/"
      },
      {
        name: "Ending Violence Canada Sexual Assault Centres & Crisis Lines",
        description: "National directory of sexual assault centres, crisis lines, and support services across Canada.",
        contact: "https://endingviolencecanada.org/sexual-assault-centres-crisis-lines-and-support-services/"
      },
      {
        name: "Surrey Women's Centre",
        description: "Support services for women in Surrey including crisis intervention, counseling, and advocacy.",
        contact: "https://www.surreywomenscentre.ca/"
      },
      {
        name: "Vancouver Rape Relief & Women's Shelter",
        description: "Transition house and rape crisis services for women and children fleeing violence in Vancouver.",
        contact: "https://www.rapereliefshelter.bc.ca/"
      },
      {
        name: "Tri-City Transitions",
        description: "Transition house providing emergency shelter and support for women and children fleeing abuse in Coquitlam, Port Coquitlam, and Port Moody.",
        contact: "https://www.tricitytransitions.ca/"
      }
    ];

    // Check if user is in Greater Vancouver
    const locationStr = userProfile.location?.toLowerCase() || "";
    const isVancouver = locationStr.includes("vancouver") || locationStr.includes("burnaby") || locationStr.includes("richmond") || locationStr.includes("surrey") || locationStr.includes("coquitlam") || locationStr.includes("new westminster") || locationStr.includes("delta") || locationStr.includes("langley") || locationStr.includes("north vancouver") || locationStr.includes("west vancouver");

    // UBC proximity: Point Grey, UBC, Kitsilano, West Point Grey area
    const isNearUBC = locationStr.includes("ubc") || locationStr.includes("point grey") || locationStr.includes("kitsilano") || locationStr.includes("west point grey");

    // SFU proximity: Burnaby Mountain, SFU, Simon Fraser
    const isNearSFU = locationStr.includes("sfu") || locationStr.includes("simon fraser") || locationStr.includes("burnaby mountain");

    // Student-related keywords in conversation context
    const chatLower = chatHistory.toLowerCase();
    const mentionsUBC = chatLower.includes("ubc") || chatLower.includes("university of british columbia");
    const mentionsSFU = chatLower.includes("sfu") || chatLower.includes("simon fraser");
    const mentionsStudent = chatLower.includes("student") || chatLower.includes("campus") || chatLower.includes("university") || chatLower.includes("college");

    const ubcResources: Resource[] = [
      {
        name: "Salal Sexual Violence Support Centre (SVSC)",
        description: "Provides support, advocacy, and counseling for survivors of sexual violence in Greater Vancouver, including support for UBC community members.",
        contact: "https://www.salalsvsc.ca/"
      },
      {
        name: "AMS Sexual Assault Support Centre (SASC) — UBC",
        description: "Free, confidential support for UBC students affected by sexual violence. Offers crisis support, advocacy, and referrals. Run by the AMS student society.",
        contact: "https://www.ams.ubc.ca/support-services/sasc/"
      }
    ];

    const sfuResources: Resource[] = [
      {
        name: "Sexual Violence Support & Prevention Office — SFU",
        description: "Free support for SFU students affected by sexual violence or harassment. After an initial intake interview, students can access free ongoing counseling. Provides confidential advocacy and resources.",
        contact: "https://www.sfu.ca/sexual-violence-support.html"
      }
    ];

    const prompt = `
User Profile Context:
- Location: ${userProfile.location}
- Gender: ${userProfile.gender}

Based on the following conversation, please compile a list of relevant local and national support resources for the user. These could include crisis hotlines, legal aid services, counseling centers, or shelters. Focus on resources that are most applicable to the user's situation as described in the conversation and their location. Provide 3-5 distinct resources. Format the output as a JSON object that matches the provided schema.

Conversation:
${chatHistory}`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: resourceGenerationSchema,
            temperature: 0.2
        }
    });

    const jsonString = response.text;
    try {
        const parsedJson = JSON.parse(jsonString);
        let resources: Resource[] = parsedJson.resources || [];
        if (isVancouver) {
          const contextResources: Resource[] = [...vancouverResources];

          // Add UBC resources if near UBC campus or user mentions UBC/being a student
          if (isNearUBC || mentionsUBC || ((isNearSFU || mentionsSFU) === false && mentionsStudent)) {
            contextResources.push(...ubcResources);
          }

          // Add SFU resources if near SFU or user mentions SFU
          if (isNearSFU || mentionsSFU) {
            contextResources.push(...sfuResources);
          }

          // Prepend context resources, remove duplicates by name
          const allResources = [...contextResources, ...resources];
          const seen = new Set<string>();
          resources = allResources.filter(r => {
            if (seen.has(r.name)) return false;
            seen.add(r.name);
            return true;
          });
        }
        return { resources };
    } catch (e) {
        console.error("Failed to parse JSON from Gemini for resources:", jsonString);
        throw new Error("The AI returned an invalid resource list format. Please try again.");
    }
};
