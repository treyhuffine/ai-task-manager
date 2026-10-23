# Using Ri on multiple computers

Keep your work together and pick it up from your laptop, desktop or phone. Every connected device opens the same tasks, notes and conversations. Agents can keep working on an always-on computer while you use Ri somewhere else.

## Start on one computer

Choose **Start a new Ri** on the computer that will hold your data and run your agents. Ri calls this computer your **Home**. A desktop you usually leave on is a good choice if you want access from other devices.

Starting a new Ri creates its local data after you make this choice. Simply opening the welcome screen does not create a tasks database. You do not need to configure remote access or another computer to use Ri locally.

If you already use Ri on this computer, choose **Use existing Ri on this computer** when offered. If your installation needs review or lives in another folder, open **Advanced**, then **Existing installation and recovery** and **Choose an existing installation**. Ri verifies the installation before you select it. Starting a new Ri creates a separate place for your data and does not merge an older installation.

## Connect another computer

1. On your Home, open **Settings**, then **Devices**.
2. Create a pairing link for the computer you want to add.
3. On that computer, choose **Connect to an existing remote Ri**.
4. Paste the pairing link and choose **Connect**.

Your Home must have an address that the other computer can reach. The pairing link identifies that Home and grants this computer access, so keep it private. Create a separate link for each computer.

Connecting opens the same Ri. It does not create or copy a tasks database on the connected computer. That computer stores its connection and local preferences. On future launches, Ri opens the saved connection automatically.

If you removed this computer from Devices and want to connect it again, create a new pairing link on your Home. On the disconnected computer, choose **Sign in again** and paste the new link. Ri accepts the new device while keeping the previous device's local work records separately. You do not need to clear the app's data.

Removing a device also turns off its access to run agents. After reconnecting, you can enable agents again in **Desktop Settings**, under **Agents on this computer**.

## Decide where agents can work

Your Home runs agents locally. A connected computer can also run work using its own agent folders, tools and sign-ins. This is useful when a project, a signed-in tool or a more powerful machine is available there.

**Run agents on this computer** starts unchecked. Leave it off to view and manage work only. Enable it when you want your Home to run agents on this computer using the folders you set up here.

You can enable local agents later in the application menu under **Desktop Settings**, then **Agents on this computer**. The same section lets you stop and resume local execution. Stopping execution here leaves your Home and work on other computers running.

## When a computer is offline

Your Home must be awake and reachable to open its Ri from another device. If the connection drops, Ri keeps the saved connection and lets you retry or update it. It does not silently create a replacement Home.

A sleeping connected computer cannot run local agents. Closing or quitting the desktop window leaves its background service running. Notification and Quick Capture availability also depends on the desktop app, so their login preference is separate from the service’s login preference. Both live in expandable sections in **Desktop Settings**.

## Teams

Your personal Ri can connect to team spaces so you can handle personal and shared work together. Team members get access to the shared work they are authorized to use, without access to your private tasks, notes, conversations or execution controls.

People who only use a team space can open it in a browser without setting up a personal Home, installing the desktop app or enabling agents.

To use shared AI, the owner opens the team’s **Settings**, then **AI & Models**, turns AI on and configures a Team agent with a folder on the Team server. Ri uses the ordinary installed harnesses and their existing sign-in flow. Everyone on the team uses that server sign-in and its account limits. Team chats and agent output belong to the team. Any active member can stop work, answer a question, approve a permission prompt or close a chat. Only a signed-in person can answer or approve.

Team agents run as the server’s OS user. On a server that also holds personal Ri data, the owner sees a warning about access to its files and signed-in accounts. Personal work stays private through app permissions, while the shared OS account is a trusted boundary. A dedicated server avoids co-hosting personal data. Tasks, notes, Areas and membership work with AI off.

Older chats retain their history and bind to an ordinary Team agent when continued. An old encrypted Anthropic credential is retained as unused until the owner removes it. It does not select billing for ordinary harness sessions.

**Connect your AI** in team Settings is a separate option for giving your own assistant access to shared work. Its member access token authorizes team tools. It does not pay for model usage.

## Read this help offline

The welcome and connection screens include **Using Ri on multiple computers**. It opens a built-in guide, so help remains available before setup and while your Home is unreachable.
