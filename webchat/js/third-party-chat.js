class WebChatWidget {
  constructor(chatService) {
    this.chatService = chatService;
    this.chatStarted = false;
    this.handleStartChatClick = this.handleStartChatClick.bind(this);
    this.handleCancelChatClick = this.handleCancelChatClick.bind(this);
  }

  render(containerId) {
    this.container = document.querySelector(`#${containerId}`);
    if (!this.container) throw "Couldn't render Chat widget";

    this.chatWidgetTemplate = document.querySelector("#chatWidgetTemplate");
    this.renderChatForm();
  }

  renderChatForm() {
    const chatWidgetNode = this.chatWidgetTemplate.content.cloneNode(true);
    this.chatWidget = chatWidgetNode.querySelector("#chatWidget");

    const chatFormTemplate = document.querySelector("#chatFormTemplate");
    const chatFormNode = chatFormTemplate.content.cloneNode(true);
    this.chatForm = chatFormNode.querySelector("#chatForm");

    const chatFormControlsTemplate = document.querySelector(
      "#chatFormControls"
    );
    const chatFormControlsNode = chatFormControlsTemplate.content.cloneNode(
      true
    );
    const startChatButton = chatFormControlsNode.querySelector("#startChat");
    startChatButton.addEventListener("click", this.handleStartChatClick);
    const cancelChatButton = chatFormControlsNode.querySelector("#cancelChat");
    cancelChatButton.addEventListener("click", this.handleCancelChatClick);

    chatWidgetNode
      .querySelector("#chatWidgetContent")
      .appendChild(chatFormNode);
    chatWidgetNode
      .querySelector("#chatWidgetFooter")
      .appendChild(chatFormControlsNode);

    this.container.appendChild(chatWidgetNode);
  }

  handleStartChatClick() {
    console.log("Starting chat...");
    const firstNameField = this.chatForm.querySelector("#firstName");
    const lastNameField = this.chatForm.querySelector("#lastName");
    const emailField = this.chatForm.querySelector("#email");

    const firstName = firstNameField.value;
    const lastName = lastNameField.value;
    const displayName = `${firstName} ${lastName}`;
    const email = emailField.value;

    const routingTarget = {
      targetType: "queue",
      targetAddress: "Marketing",
    };
    const memberInfo = {
      displayName: displayName,
      firstName: firstName,
      lastName: lastName,
      email: email,
    };

    this.chatService.start(memberInfo, routingTarget);
    this.chatWidgetNode.innerHTML = "";
    this.chatService.addEventListener("chat-started", (chatStartedEvent) => {
      console.log("Chat started:", chatStartedEvent);
    });
  }

  handleCancelChatClick() {}

  showChatConversation() {
    const chatConvControlsTemplate = document.querySelector(
      "#chatConvControls"
    );
    let chatConvControlsNode = chatConvControlsTemplate.content.cloneNode(true);

    this.chatWidget
      .querySelector("#chatWidgetFooter")
      .appendChild(chatConvControlsNode);

    const chatWidgetContainer = document.querySelector("#widgetContainer");
    chatWidgetContainer.appendChild(this.chatWidgetNode);
  }
}

class WebChatService extends EventTarget {
  constructor(organizationId, deploymentId) {
    super();
    this.organizationId = organizationId;
    this.deploymentId = deploymentId;
    this.isWsConnected = false;
  }

  /** Public methods */
  start(memberInfo, routingTarget) {
    this.createWebChatConversation(memberInfo, routingTarget)
      .then((data) => {
        const { id, eventStreamUri, jwt, member } = data;
        this.session = {
          conversationId: id,
          jwt: jwt,
          me: member,
          isConnected: true,
        };
        console.log(`Created WebChat conversation ID ${id}`);
        console.log(
          `Connecting to websocket ${eventStreamUri} for conversation ${id}`
        );
        this.connectToWebSocket(eventStreamUri);
      })
      .catch((error) => {
        console.error(error);
      });
  }

  sendMessage(body, opt_bodyType) {
    if (!this.isWsConnected) {
      throw "WebChat is not connected. Can't send message";
      return;
    }
    const bodyType = opt_bodyType || "standard";
    if (["standard", "notice"].indexOf(bodyType) < 0) {
      throw `Message type ${bodyType} not supported (valid values: standard | notice)`;
    }

    const { conversationId, jwt, me } = this.session;
    const endpoint = `${WebChatService.GUEST_CHAT_API}/conversations/${conversationId}/members/${me.id}/messages`;
    const data = {
      body: body,
      bodyType: bodyType,
    };

    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(data),
    });
  }

  sendTypingIndicator() {
    const { conversationId, jwt, me } = this.session;
    const endpoint = `${WebChatService.GUEST_CHAT_API}/conversations/${conversationId}/members/${me.id}/typing`;

    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
    });
  }

  disonnect() {
    const { conversationId, jwt, me, isConnected } = this.session;
    const endpoint = `${WebChatService.GUEST_CHAT_API}/conversations/${conversationId}/members/${me.id}`;

    if (!isConnected) return; // Already disconnected

    console.log("Disconnecting from WebChat...");
    fetch(endpoint, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
    })
      .then(() => {
        this.session.isConnected = false;
        if (this.isWsConnected) this.socket.close();
      })
      .catch((error) => console.error(error));
  }

  /** Private methods */
  async createWebChatConversation(memberInfo, routingTarget) {
    const endpoint = `${WebChatService.GUEST_CHAT_API}/conversations`;
    const data = {
      organizationId: this.organizationId,
      deploymentId: this.deploymentId,
      routingTarget: routingTarget,
      memberInfo: memberInfo,
    };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return response.json();
  }

  connectToWebSocket(eventStreamUri) {
    const socket = new WebSocket(eventStreamUri);

    // Connection opened
    socket.addEventListener("open", (event) => {
      console.log("Connected to chat websocket");
      this.isWsConnected = true;
      const chatStartedEvent = new CustomEvent("chat-started", {
        detail: {
          session: this.session,
        },
      });
      this.dispatchEvent(chatStartedEvent);
    });

    // Connection closed
    socket.addEventListener("close", (closeEvent) => {
      console.log(`Chat websocket closed:
      Code: ${closeEvent.code},
      Reason: ${closeEvent.reason},
      WasClean: ${closeEvent.wasClean}
      `);
      this.isWsConnected = false;
    });

    // Listen for messages
    socket.addEventListener("message", (event) => {
      const eventData = JSON.parse(event.data);
      this.processWebChatEventData(eventData);
    });

    //Error
    socket.addEventListener("error", (event) => {
      console.error(event);
    });

    this.socket = socket;
  }

  processWebChatEventData(eventData) {
    const { topicName, eventBody } = eventData;

    if (topicName === "channel.metadata") {
      console.log("WebChat Channel Metadata received: ", eventBody);
      // TODO: implement checks to detect lack of channel heartbeats:
      // https://developer.mypurecloud.com/api/webchat/guestchat.html#_span_style__text_transform__none__websocket_heartbeats__span_
      return;
    }

    const { type } = eventData.metadata;
    switch (type) {
      case "message":
        this.processWebChatMessage(eventData);
        break;
      case "typing-indicator":
        this.processWebChatTypingIndicator(eventData);
        break;
      case "member-change":
        this.processWebChatMemberStateChage(eventData);
        break;
      default:
        console.warn("Got non-handled WebChat Message event type:");
        console.warn(eventData);
    }
  }

  processWebChatMessage(eventData) {
    const { eventBody } = eventData;
    const correlationId = eventData.metadata.CorrelationId;

    switch (eventBody.bodyType) {
      case "standard":
        this.processWebChatStandardMessage(eventBody, correlationId);
        break;
      case "member-join":
        this.processWebChatMemberJoinMessage(eventBody, correlationId);
        break;
      case "member-leave":
        this.processWebChatMemberLeaveMessage(eventBody, correlationId);
        break;
      default:
        console.warn("Got non-handled WebChat Message event type:");
        console.warn(eventData);
    }
  }

  processWebChatStandardMessage(msgData, correlationId) {
    const { id, sender, body, timestamp } = msgData;
    console.log(`WebChat standard message:
        ID: ${id}
        Timestamp: ${timestamp}
      Sender: ${sender.id}
         Body: ${body}
      CorrelationId: ${correlationId}`);

    const standardMessageEvent = new CustomEvent("message", {
      detail: {
        timestamp: timestamp,
        messageId: id,
        sender: sender.id,
        body: body,
      },
    });
    this.dispatchEvent(standardMessageEvent);
  }

  processWebChatMemberJoinMessage(msgData, correlationId) {
    const { sender, timestamp } = msgData;

    console.log(`WebChat member joined:
        Timestamp: ${timestamp}
      Member: ${sender.id}
      CorrelationId: ${correlationId}
    `);

    const memberJoinEvent = new CustomEvent("member-join", {
      detail: {
        timestamp: timestamp,
        member: sender.id,
      },
    });
    this.dispatchEvent(memberJoinEvent);
  }

  processWebChatMemberLeaveMessage(msgData, correlationId) {
    const { sender, timestamp } = msgData;

    console.log(`WebChat member left:
        Timestamp: ${timestamp}
      Member: ${sender.id}
      CorrelationId: ${correlationId}
    `);

    const memberLeaveEvent = new CustomEvent("member-leave", {
      detail: {
        timestamp: timestamp,
        member: sender.id,
      },
    });
    this.dispatchEvent(memberLeaveEvent);
  }

  processWebChatTypingIndicator(eventData) {
    const { eventBody, metadata } = eventData;
    const { sender, timestamp } = eventBody;

    console.log(`WebChat member is typing:
        Timestamp: ${timestamp}
      Member: ${sender.id}
      CorrelationId: ${metadata.CorrelationId}
    `);

    const memberTypingEvent = new CustomEvent("member-typing", {
      detail: {
        timestamp: timestamp,
        member: sender.id,
      },
    });
    this.dispatchEvent(memberTypingEvent);
  }

  processWebChatMemberStateChage(eventData) {
    const { eventBody, metadata } = eventData;
    const { member, timestamp } = eventBody;

    console.log(`WebChat member state changed:
        Timestamp: ${timestamp}
      Member: ${member.id}
      Changed To: ${member.state}
      CorrelationId: ${metadata.CorrelationId}
    `);

    const memberStateChangeEvent = new CustomEvent("member-state-change", {
      detail: {
        timestamp: timestamp,
        member: member.id,
        newState: member.state,
      },
    });
    this.dispatchEvent(memberStateChangeEvent);
  }
}
WebChatService.GUEST_CHAT_API =
  "https://api.mypurecloud.com/api/v2/webchat/guest";
