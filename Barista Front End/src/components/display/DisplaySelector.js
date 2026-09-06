import React, { useState, useEffect } from 'react';
import { DISPLAY_POLL_MS } from './DisplayScreen';
import { useNavigate } from 'react-router-dom';
import { Coffee, Monitor, ArrowLeft, Loader, Hand, Eye, Copy, Check, Award } from 'lucide-react';
import StationsService from '../../services/StationsService';

const DisplaySelector = () => {
  const navigate = useNavigate();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load stations on component mount
  useEffect(() => {
    const loadStations = async () => {
      try {
        setLoading(true);
        const stationsResponse = await StationsService.getStations();
        
        if (stationsResponse && stationsResponse.length > 0) {
          console.log('Loaded stations for display selector:', stationsResponse);
          setStations(stationsResponse);
        } else {
          setError('No stations found. Please create stations first in the Organiser interface.');
        }
      } catch (err) {
        console.error('Error loading stations:', err);
        setError('Failed to load stations: ' + (err.message || 'Unknown error'));
      } finally {
        setLoading(false);
      }
    };
    
    loadStations();
  }, []);

  // A station can need TWO screens at once, and they are not the same
  // screen. Steve: "sometimes touchscreen not avaliable or there might be
  // a touchscreen and a static display".
  //
  //   touch  -> the board plus the big "Order here" button. Needs someone
  //             able to reach the screen.
  //   viewer -> the same board with no order button. The SMS line is
  //             promoted to the main call to action instead, because a
  //             screen nobody can touch still has to tell people how to
  //             order.
  //
  // Both are stated explicitly on the URL rather than left to the global
  // "This display is a touchscreen" default, so the choice made here is
  // the choice that screen gets -- whatever that default happens to be.
  const displayUrl = (stationId, kind) =>
    `/display?station=${stationId}&kiosk=${kind === 'viewer' ? '0' : '1'}`;

  const goToDisplayForStation = (stationId, kind = 'touch') => {
    navigate(displayUrl(stationId, kind));
  };

  // Setting up the second screen usually means getting this address onto a
  // DIFFERENT device, so the full URL is more use than the click.
  const [copied, setCopied] = useState('');
  const copyUrl = async (stationId, kind) => {
    const url = `${window.location.origin}${displayUrl(stationId, kind)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch (e) {
      // Clipboard is blocked without https or a user gesture on some
      // devices. Falling back to a prompt still lets them copy by hand.
      window.prompt('Copy this address for the other screen:', url);
    }
    setCopied(`${stationId}:${kind}`);
    setTimeout(() => setCopied(''), 2000);
  };

  // The sponsor wall is one event-wide screen (/sponsors), not per-station.
  const copySponsorUrl = async () => {
    const url = `${window.location.origin}/sponsors`;
    try { await navigator.clipboard.writeText(url); }
    catch (e) { window.prompt('Copy this address for the sponsor screen:', url); }
    setCopied('sponsors:wall');
    setTimeout(() => setCopied(''), 2000);
  };

  // One card, two ways in. Shared by the stations and the All Stations row
  // so they can never drift apart.
  const OpenButtons = ({ id }) => (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
      {[
        { kind: 'touch',  Icon: Hand, label: 'Touchscreen',
          hint: 'With the Order here button' },
        { kind: 'viewer', Icon: Eye,  label: 'Viewer only',
          hint: 'No order button \u2014 SMS instead' },
      ].map(({ kind, Icon, label, hint }) => (
        <div key={kind} className="border rounded-lg p-2 hover:border-blue-400 transition-colors">
          <button
            type="button"
            onClick={() => goToDisplayForStation(id, kind)}
            className="w-full flex items-center gap-2 font-semibold text-gray-800 text-left"
          >
            <Icon size={18} className="shrink-0 text-blue-600" />
            {label}
          </button>
          <div className="text-xs text-gray-500 mt-0.5">{hint}</div>
          <button
            type="button"
            onClick={() => copyUrl(id, kind)}
            className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            {copied === `${id}:${kind}`
              ? <><Check size={12} /> Address copied</>
              : <><Copy size={12} /> Copy address</>}
          </button>
        </div>
      ))}
    </div>
  );

  // Go back to landing page
  const goBack = () => {
    navigate('/welcome');
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4">
        <div className="container mx-auto flex items-center">
          <button 
            onClick={goBack}
            className="mr-4 p-2 rounded-full hover:bg-blue-700 transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex items-center">
            <Monitor size={32} className="mr-2" />
            <h1 className="text-2xl font-bold">Display Screen Selector</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow container mx-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Select a Station Display</h2>
            <p className="text-gray-600 mb-6">
              Choose a station, then how that screen is used. A station can run
              both at once &mdash; a touchscreen customers order from, and a
              second screen on the wall that only shows the queue.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              A <strong>viewer only</strong> screen shows the same orders but has
              no Order here button, so nobody can order by walking up to it. It
              shows the SMS number as the main way to order instead.
            </p>
            
            {/* Error Message */}
            {error && (
              <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6">
                <p>{error}</p>
              </div>
            )}
            
            {/* Loading State */}
            {loading ? (
              <div className="flex justify-center items-center p-12">
                <Loader size={40} className="animate-spin text-blue-600" />
                <span className="ml-3 text-gray-600">Loading stations...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stations.map(station => (
                  <div
                    key={station.id}
                    className="border rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mr-3">
                        <Coffee size={20} className="text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-800">{station.name}</h3>
                        <p className="text-sm text-gray-600">{station.location || 'No location specified'}</p>
                        <p className="mt-2 text-xs">
                          <span className={`inline-block rounded-full px-2 py-1 ${station.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {station.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <OpenButtons id={station.id} />
                  </div>
                ))}

                {/* All Stations Option */}
                <div className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start">
                    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center mr-3">
                      <Monitor size={20} className="text-purple-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800">All Stations</h3>
                      <p className="text-sm text-gray-600">Combined display of all station orders</p>
                      <p className="mt-2 text-xs">
                        <span className="inline-block rounded-full px-2 py-1 bg-purple-100 text-purple-800">
                          Overview
                        </span>
                      </p>
                    </div>
                  </div>
                  <OpenButtons id="all" />
                </div>

                {/* Sponsor Wall — one event-wide screen; grid/scroll,
                    background and the ticker are all set in Organiser → Branding → Sponsors. */}
                <div className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start">
                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center mr-3">
                      <Award size={20} className="text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800">Sponsor Wall</h3>
                      <p className="text-sm text-gray-600">Full-screen sponsor logos. Grid or scroll, background and ticker are set in Organiser &rarr; Sponsors.</p>
                      <p className="mt-2 text-xs">
                        <span className="inline-block rounded-full px-2 py-1 bg-amber-100 text-amber-800">Sponsors</span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 border rounded-lg p-2 hover:border-amber-400 transition-colors">
                    <button
                      type="button"
                      onClick={() => navigate('/sponsors')}
                      className="w-full flex items-center gap-2 font-semibold text-gray-800 text-left"
                    >
                      <Award size={18} className="shrink-0 text-amber-600" /> Open sponsor wall
                    </button>
                    <div className="text-xs text-gray-500 mt-0.5">Adapts to vertical or landscape</div>
                    <button
                      type="button"
                      onClick={copySponsorUrl}
                      className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      {copied === 'sponsors:wall'
                        ? <><Check size={12} /> Address copied</>
                        : <><Copy size={12} /> Copy address</>}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <div className="text-center text-gray-500 text-sm">
            {/* Quotes the real constant rather than a number typed here.
                This said "20 seconds" while the board actually polled 8. */}
            <p>Displays update the moment an order changes, and re-check every{' '}
            {Math.round(DISPLAY_POLL_MS / 1000)} seconds as a backstop. You can also
            refresh manually with the button on the display screen.</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DisplaySelector;