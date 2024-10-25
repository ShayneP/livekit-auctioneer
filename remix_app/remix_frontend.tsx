import {
    Links,
    Meta,
    Scripts,
    useLoaderData,
    Form
  } from "@remix-run/react";
  import { VideoConference, LiveKitRoom, RoomName, useLocalParticipant, useParticipants, useRoomInfo, RoomContext } from "@livekit/components-react";
  import { useState, useEffect } from "react";
  import { LoaderFunction, json } from "@remix-run/node";
  import { AccessToken } from 'livekit-server-sdk';
  
  // Global Set to store active usernames
  const activeUsernames = new Set<string>();
  
  export const loader: LoaderFunction = async ({ request }) => {
    const url = new URL(request.url);
    const username = url.searchParams.get("username");
  
    // Check if username is provided
    if (!username) {
      return json({ serverUrl: 'wss://test-app-01-hp3nzyw3.livekit.cloud', token: null, error: null });
    }
  
    // Check for duplicate username
    if (activeUsernames.has(username)) {
      return json({ serverUrl: 'wss://test-app-01-hp3nzyw3.livekit.cloud', token: null, error: 'Username already taken. Please choose a different one.' });
    }
  
    // Add username to the active set
    activeUsernames.add(username);
  
    const roomName = "cerebras-demo-auction";
  
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
      {
        identity: username,
        ttl: '30m'
      }
    );
    at.addGrant({ roomJoin: true, room: roomName, canUpdateOwnMetadata: true });
  
    const token = await at.toJwt();
    
    return json({ serverUrl: 'wss://test-app-01-hp3nzyw3.livekit.cloud', token, error: null });
  };
  
  export default function App() {
    const [username, setUsername] = useState('');
    const [error, setError] = useState<string | null>(null);
    const { serverUrl, token, error: loaderError } = useLoaderData<{ serverUrl: string, token: string | null, error: string | null }>();
  
    useEffect(() => {
      if (loaderError) {
        setError(loaderError);
        activeUsernames.delete(username);
      }
    }, [loaderError, username]);
  
    if (!token) {
      return (
        <div className="login-container">
        <link rel="stylesheet" href="/app/app.css" />
            <h2>Enter the Auction</h2>
            {error && <p className="error-message">{error}</p>}
            <Form method="get" className="login-form">
              <input 
                type="text" 
                name="username" 
                value={username} 
                onChange={(e) => setUsername(e.target.value)} 
                placeholder="Enter your username" 
                required 
              />
              <button type="submit">Enter the auction</button>
            </Form>
        </div>
      );
    }
  
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <Meta />
          <Links />
        </head>
        <body>
          <LiveKitRoom serverUrl={serverUrl} token={token}>
            <RoomContent />
          </LiveKitRoom>
          <Scripts />
        </body>
      </html>
    );
  }
  
  function RoomContent() {
    const { localParticipant } = useLocalParticipant();
    const participants = useParticipants();
    const [currentBid, setCurrentBid] = useState(0);
    const [highestBidder, setHighestBidder] = useState<string>('');
    const [bidAmount, setBidAmount] = useState('');
    // Add new state variables for cooldown
    const [cooldownActive, setCooldownActive] = useState(false);
    const [cooldownTime, setCooldownTime] = useState(0);
  
    useEffect(() => {
      let highestBid = 0;
      let highestBidder = '';
      
      for (const participant of participants) {
        const bid = participant?.attributes?.data ? JSON.parse(participant.attributes.data).bid : 0;
        if (bid > highestBid) {
          highestBid = bid;
          highestBidder = participant.identity;
        }
      }
      
      setCurrentBid(highestBid);
      setHighestBidder(highestBidder);
    }, [participants]);
  
    const handleBid = () => {
      const newBid = parseFloat(bidAmount);
      if (isNaN(newBid)) {
        alert('Please enter a valid bid amount');
        return;
      }
      // Round to 2 decimal places to prevent floating point issues
      const roundedBid = Math.round(newBid * 100) / 100;
      if (roundedBid > 1337) {
        alert('Try again! Bid is too high!');
        return;
      }
      if (roundedBid <= currentBid) {
        alert('Please enter a bid higher than the current bid');
        return;
      }
      
      localParticipant?.setAttributes({
        data: JSON.stringify({ bid: roundedBid }),
        participant: localParticipant.identity
      });
      setBidAmount('');
  
      // Start cooldown
      setCooldownActive(true);
      setCooldownTime(3);
  
      // Start countdown timer
      const timer = setInterval(() => {
        setCooldownTime((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setCooldownActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    };
  
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      // Allow numbers with up to two decimal places
      if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) {
        setBidAmount(value);
      }
    };
  
    return (
      <div className="room-container">
        <link rel="stylesheet" href="/app/app.css" />
        <div className="room-header">
          Cerebras Realtime Auction
        </div>
        <div className="name-header">
          <div>Bidding as: {localParticipant?.identity}</div>
        </div>
        
        <div className="bid-info">
          <div className="current-bid">Current bid: ${currentBid.toFixed(2)}</div>
          {highestBidder && <div className="highest-bidder">Highest bidder: {highestBidder}</div>}
        </div>
  
        <div className="bid-controls">
          <input
            type="text"
            inputMode="decimal"
            className="bid-input"
            value={bidAmount}
            onChange={handleInputChange}
            placeholder={`Enter bid amount (> $${currentBid.toFixed(2)})`}
            disabled={cooldownActive}
            pattern="\d*\.?\d{0,2}" // HTML5 pattern for numbers with up to 2 decimal places
          />
          <button 
            className="bid-button"
            onClick={handleBid}
            disabled={cooldownActive}
          >
            {cooldownActive ? `Wait ${cooldownTime}s` : 'Place Bid'}
          </button>
        </div>
      </div>
    );
  }
  