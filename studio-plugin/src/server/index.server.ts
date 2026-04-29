import { RunService } from "@rbxts/services";
import State from "../modules/State";
import UI from "../modules/UI";
import Communication from "../modules/Communication";

// In Play mode, Roblox loads the plugin in playtest DataModel(s) too.
// Only the edit-DataModel plugin should own the MCP toolbar, DockWidget, and
// /ready registration. Otherwise we get a second floating window with a retry
// storm and duplicate role=edit registrations.
if (RunService.IsEdit()) {
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
