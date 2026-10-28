import { expect, test } from "bun:test"
import * as Tree from "./tree.js"

const messages = [
  { id: "msg_u1", type: "user" },
  { id: "msg_a1", type: "assistant" },
  { id: "msg_u2", type: "user" },
  { id: "msg_a2", type: "assistant" },
  { id: "msg_u3", type: "user" },
  { id: "msg_a3", type: "assistant" },
]

test("initializes and branches from the active node", () => {
  const base = Tree.initialize([
    { id: "msg_u1", text: "first" },
    { id: "msg_u2", text: "second" },
  ])!
  expect(base).toMatchObject({
    root: "msg_u1",
    active: "msg_u2",
    nodes: { msg_u1: { label: "first" }, msg_u2: { parent: "msg_u1", label: "second" } },
  })
  const sibling = Tree.add(Tree.switchTo(base, "msg_u1"), "msg_u3", "third")
  expect(sibling.nodes.msg_u3).toEqual({ parent: "msg_u1", label: "third" })
})

test("filters the visible transcript to the active ancestry", () => {
  const tree: Tree.Info = {
    version: 1,
    root: "msg_u1",
    active: "msg_u2",
    nodes: {
      msg_u1: { label: "first" },
      msg_u2: { parent: "msg_u1", label: "second" },
      msg_u3: { parent: "msg_u1", label: "third" },
    },
  }
  expect(Tree.visible(tree, messages).map((message) => message.id)).toEqual([
    "msg_u1",
    "msg_a1",
    "msg_u2",
    "msg_a2",
  ])
  expect(Tree.visible({ ...tree, active: "msg_u1" }, messages).map((message) => message.id)).toEqual([
    "msg_u1",
    "msg_a1",
  ])
})

test("links another branch into the model history", () => {
  const tree: Tree.Info = {
    version: 1,
    root: "msg_u1",
    active: "msg_u2",
    nodes: {
      msg_u1: { label: "first" },
      msg_u2: { parent: "msg_u1", label: "second", links: ["msg_u3"] },
      msg_u3: { parent: "msg_u1", label: "third" },
    },
  }
  expect(Tree.historyMessages(tree, messages).map((message) => message.id)).toEqual([
    "msg_u1",
    "msg_a1",
    "msg_u2",
    "msg_a2",
    "msg_u3",
    "msg_a3",
  ])
  expect(Tree.visible(tree, messages).map((message) => message.id)).not.toContain("msg_u3")
})

test("creates new roots and clears the tree when the last root is removed", () => {
  const base = Tree.initialize([{ id: "msg_u1", text: "first" }])!
  const rooted = Tree.addRoot(Tree.armRoot(base), "msg_u4", "fourth")
  expect(rooted).toMatchObject({
    root: "msg_u1",
    active: "msg_u4",
    pendingRoot: false,
    nodes: { msg_u1: { label: "first" }, msg_u4: { label: "fourth" } },
  })
  expect(Tree.order(rooted).map((item) => item.id)).toEqual(["msg_u1", "msg_u4"])
  expect(Tree.remove(rooted, "msg_u1")).toMatchObject({ root: "msg_u4", active: "msg_u4" })
  expect(Tree.remove({ ...rooted, nodes: { msg_u4: { label: "fourth" } } }, "msg_u4")).toEqual({
    version: 1,
    pendingRoot: true,
    nodes: {},
  })
})