import os
import logging
import threading  # Added for threading

from typing import Annotated

import livekit
import json
import asyncio
from livekit import api, rtc
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, llm, JobProcess
from livekit.agents.pipeline import VoicePipelineAgent
from livekit.plugins import openai, silero, deepgram, cartesia
from dotenv import load_dotenv

import ipdb  # Moved import to top for clarity

load_dotenv()
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")
CEREBRAS_API_KEY = os.getenv("CEREBRAS_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

logger = logging.getLogger("auctioneer-demo")
logger.setLevel(logging.INFO)

highest_bid = 0
highest_bidders = []  # Changed from None to empty list
greeted_participants = False

def prewarm_process(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()

async def entrypoint(ctx: JobContext):
    global greeted_participants
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    participant = await ctx.wait_for_participant()
    initial_chat_ctx = llm.ChatContext().append(
        text=(
            "You are an auctioneer created by LiveKit. Your interface with users is voice-based. "
            "You will manage live auctions, allowing users to place bids on available items."
            "You will announce the highest bid and the participants who have placed bids."
            "You will try to get the participants to bid higher, really talk up the item!"
            "The item is a fiddly-widget, a piece of history!"
        ),
        role="system",
    )
    agent = VoicePipelineAgent(
        vad=ctx.proc.userdata["vad"],
        stt=deepgram.STT(),
        #llm=openai.LLM(),
        llm=openai.LLM.with_cerebras(api_key=CEREBRAS_API_KEY, model="llama3.1-70b"),
        tts=cartesia.TTS(),
        chat_ctx=initial_chat_ctx,
        allow_interruptions=True
    )

    agent.start(ctx.room, participant)
    await agent.say(
        "Welcome to the auction! We're auctioning off an incredible item today, a fiddly-widget! This is a one-of-a-kind opportunity to own a piece of history. "
        "The auction will start at $0 and will be open for bids until the end of the auction. "
    )
    greeted_participants = True

    @ctx.room.on("participant_attributes_changed")
    def on_participant_attributes_changed(
        changed_attributes: dict[str, str], participant: rtc.Participant
    ):
        global highest_bid

        if "data" in changed_attributes:
            try:
                data = json.loads(changed_attributes["data"])
                if "bid" in data:
                    bid_amount = data["bid"]
                    participant_name = participant.attributes.get("participant", "Someone")
                    
                    # Only announce if it's a new highest bid
                    if bid_amount > highest_bid:
                        highest_bid = bid_amount
                        agent.chat_ctx.append(
                            text=f"A new bid has been placed: {participant_name} is now the highest bidder with ${bid_amount}.",
                            role="system"
                        )
                        stream = agent.llm.chat(chat_ctx=agent.chat_ctx)
                        if agent._playing_speech and agent._playing_speech.allow_interruptions:
                            agent._playing_speech.interrupt()

                        asyncio.create_task(agent.say(stream))
                        logger.info(f"New highest bid: ${highest_bid}")
                        logger.info(f"Chat context: {agent.chat_ctx}")
            except json.JSONDecodeError:
                logger.error("Failed to parse bid data")

    @ctx.room.on("participant_connected")
    def on_participant_connected(participant: rtc.Participant):
        logger.info(f"Participant connected: {participant.identity}")

if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm_process,
        ),
    )
