import { RunService } from "@rbxts/services";
import State from "../modules/State";
import UI from "../modules/UI";
import Communication from "../modules/Communication";
import StopPlayMonitor from "../modules/StopPlayMonitor";
import RenderMonitor from "../modules/RenderMonitor";
import RuntimeLogBuffer from "../modules/RuntimeLogBuffer";

StopPlayMonitor.init(plugin);

// Play-server DM: run ONLY the stop-signal monitor (1Hz settings poll).
// Cross-DM MessageOut reflection from edit → play-server does not work, and
// EndTest is illegal from the edit DM, so the play-server DM must consume
// stop_playtest requests itself via the plugin-settings mailbox.
if (!RunService.IsEdit() && RunService.IsServer()) {
	StopPlayMonitor.startMonitor();
}

// In Play mode, Roblox loads the plugin in playtest DataModel(s) too.
// Only the edit-DataModel plugin should own the MCP toolbar, DockWidget, and
// /ready registration. Otherwise we get a second floating window with a retry
// storm and duplicate role=edit registrations.
if (RunService.IsEdit()) {
	// Capture LogService output from plugin load onward (edit + in-place Run)
	// for get_runtime_logs. Install first so early boot logs are seen.
	RuntimeLogBuffer.install();
	RenderMonitor.start();
	// Stamp the anon place id now (edit DM) so any later play-DM clone shares the
	// same StopPlayMonitor mailbox key for unpublished places.
	StopPlayMonitor.ensurePlaceId();
	UI.init(plugin);
	const elements = UI.getElements();

	const toolbar = plugin.CreateToolbar("MCP Integration");
	const button = toolbar.CreateButton("MCP Server", "Connect to MCP Server for AI Integration", "rbxassetid://10734944444");

	elements.connectButton.Activated.Connect(() => {
		const conn = State.getActiveConnection();
		if (conn && conn.isActive) {
			Communication.deactivatePlugin(State.getActiveTabIndex());
		} else {
			Communication.activatePlugin(State.getActiveTabIndex());
		}
	});

	button.Click.Connect(() => {
		elements.screenGui.Enabled = !elements.screenGui.Enabled;
	});

	plugin.Unloading.Connect(() => {
		Communication.deactivateAll();
	});

	UI.updateUIState();
	Communication.checkForUpdates();

	// Auto-connect default tab on plugin load.
	// Disconnect mid-session stays disconnected; next plugin reload reconnects.
	task.defer(() => Communication.activatePlugin(0));
}
