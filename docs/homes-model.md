# How Ri works across your computers

One page. Everything on screen has to fit it. When something doesn't, the product changes, not this page.

## In one sentence

Your Ri lives on one computer. Your other computers can do work for it. Each piece of work runs on one computer at a time, and from anywhere you can see it, steer it, or move it to another computer.

## The pieces

- **Your Ri.** One computer holds everything: tasks, notes, agents, every chat. For you that's the Mac Mini, because it's always on. Your phone and your laptop's browser are windows onto it.
- **Your computers.** The Mac Mini and your MacBook. Any of them can run work. A computer runs work once Ri is running on it, and it only runs work for your Ri.
- **Agents.** A project, like Ri. It's one agent no matter how many computers it's on. On each computer it has a folder, which can be in a different place on each.
- **Work.** One piece of work (an execution) is a chat with an agent, in its own copy of the project, on one computer.

## What you do

- **Start work.** Press +. It runs where that agent usually runs, the Mac Mini unless you changed it. To run it somewhere else this once, use New execution on… in the agent's menu.
- **Talk to it.** From any screen. Your message goes to the computer the work is on.
- **See it.** From any screen: the chat, its changes, its files, its terminal. Looking never moves anything.
- **Move it.** Move to MacBook, or Move to Mac Mini, from the work's menu. The work stops, saves to Git, and carries on over there, with the same chat and the same history.

## What happens for you

- **Setting up a computer for an agent** happens the first time you need it there, in the app: Ri offers to get the project onto that computer, or to use a folder that's already there. You do this once per agent per computer.
- **A computer that's asleep or off** keeps your messages saved and delivers them when it's back. Nothing is lost and nothing runs twice.
- **Only the unusual is labeled.** Work on the Mac Mini shows no computer name. Work on the MacBook says MacBook.

## What you see only when something's wrong

- A message waiting for a computer that's off, with Cancel.
- A move that couldn't finish, saying what happened, with Try again, or carrying on where it was.
- A computer that isn't running Ri, with how to start it.

## Under the hood, in plain words

- **How your MacBook talks to the Mini.** The MacBook always calls the Mini, never the other way round, so it works on any network. It keeps one line open to receive instructions (a stream), and sends back what the agent does in ordinary requests. Every instruction is saved on the Mini with a number before it's sent, and the MacBook picks up from the last number it got, so a sleep or a dropped connection loses nothing.
- **Why work runs on one computer at a time.** Two computers editing the same project at once would clash. So each piece of work has one owner. A move changes the owner in one step, and instructions meant for the old owner are refused.
- **How a move carries the work.** Through Git, the way you would by hand: commit, push, and check out on the other computer. The chat never moves, because it always lived on the Mini.

## Not in the everyday product

- **Opening a read-only copy** on the computer you're at, without moving the work. It's built, and parked off the menu until it earns a place.
- **Knowing which computer your browser is on.** Not needed: you move work by naming the computer.
