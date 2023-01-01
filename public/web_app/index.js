Telegram.WebApp.ready();
Telegram.WebApp.expand();

moment.locale("ru");

const userInfo = document.querySelector(".js-user-info");
const actionsPane = document.querySelector(".js-pane-actions");
const viewPane = document.querySelector(".js-pane-view");
const pointInfo = document.querySelector(".js-point-info");
const pointDescription = document.querySelector(".js-point-description");
const appendButton = document.querySelector(".js-button-append");
const cancelButton = document.querySelector(".js-button-cancel");
const voteButton = document.querySelector(".js-button-vote");
const voteCancelButton = document.querySelector(".js-button-cancel-vote");
const refreshButton = document.querySelector(".js-refresh");

const api = axios.create({
  baseURL: "https://m.deluxspa.ru/api",
});

function fromYMapsEvents(entity, events) {
  return new rxjs.Observable(function (subscriber) {
    function onEvent(event) {
      subscriber.next(event);
    }

    entity.events.add(events, onEvent);

    return function () {
      entity.event.remove(events, onEvent);
    };
  });
}

function request$(method, ...args) {
  return new rxjs.Observable(function (subscriber) {
    let isSubscribed = true;

    api[method](...args)
      .then(function ({ data }) {
        if (isSubscribed) {
          subscriber.next(data);
          subscriber.complete();
        }
      })
      .catch(function (error) {
        if (isSubscribed) {
          subscriber.error(error);
        }
      });

    return () => {
      isSubscribed = false;
    };
  });
}

function get$(...args) {
  return request$("get", ...args);
}

function post$(...args) {
  return request$("post", ...args);
}

const ymaps$ = new rxjs.Observable(function (subscriber) {
  let isSubscribed = true;

  ymaps.ready(function () {
    if (isSubscribed) {
      subscriber.next(ymaps);
      subscriber.complete();
    }
  });

  return () => {
    isSubscribed = false;
  };
}).pipe(rxjs.shareReplay(1));

const map$ = ymaps$.pipe(
  rxjs.map(
    (ymaps) =>
      new ymaps.Map("map", {
        center: [55.76, 37.64],
        zoom: 7,
      })
  ),
  rxjs.shareReplay(1)
);

const mapClicks$ = map$.pipe(
  rxjs.mergeMap((map) => fromYMapsEvents(map, "click")),
  rxjs.shareReplay(1)
);

const balloonOpens$ = map$.pipe(
  rxjs.mergeMap((map) => fromYMapsEvents(map.balloon, "open")),
  rxjs.share()
);

const balloonCloses$ = map$.pipe(
  rxjs.mergeMap((map) => fromYMapsEvents(map.balloon, "close")),
  rxjs.share()
);

const balloonClicks$ = map$.pipe(
  rxjs.mergeMap((map) => fromYMapsEvents(map.balloon, "click")),
  rxjs.share()
);

const clusterPointSelected$ = rxjs.merge(balloonOpens$, balloonClicks$).pipe(
  rxjs.map((event) => event.originalEvent.target.balloon.getData().cluster),
  rxjs.filter(Boolean),
  rxjs.map((cluster) => cluster.state.get("activeObject"))
);

const cancelClicks$ = rxjs.fromEvent(cancelButton, "click");
const appendClicks$ = rxjs.fromEvent(appendButton, "click");

const voteClicks$ = rxjs.fromEvent(voteButton, "click");
const voteCancelClicks$ = rxjs.fromEvent(voteCancelButton, "click");

const refreshClicks$ = rxjs.fromEvent(refreshButton, "click");

const newPointCoords$ = rxjs
  .merge(
    mapClicks$.pipe(rxjs.map((event) => event.get("coords"))),
    balloonCloses$.pipe(rxjs.map(() => null))
  )
  .pipe(rxjs.distinctUntilChanged(), rxjs.shareReplay(1));

const cluster$ = rxjs.combineLatest([ymaps$, map$]).pipe(
  rxjs.map(([ymaps, map]) => {
    return map.geoObjects.getLength() === 0
      ? {
          isAppended: false,
          cluster: new ymaps.Clusterer({
            groupByCoordinates: false,
            clusterDisableClickZoom: true,
            clusterHideIconOnBalloonOpen: false,
            geoObjectHideIconOnBalloonOpen: false,
          }),
        }
      : { isAppended: true, cluster: map.geoObjects.get(0) };
  })
);

const user$ = ymaps$.pipe(
  rxjs.map(() => new URL(location.href).searchParams.get("chat_id")),
  rxjs.mergeMap((chatId) =>
    get$("/me", {
      params: {
        chat_id: chatId,
      },
    }).pipe(
      rxjs.map(({ username }) => ({ isAuthorized: true, username })),
      rxjs.catchError(() => rxjs.of({ isAuthorized: false, username: "guest" }))
    )
  ),
  rxjs.shareReplay(1)
);

const pointAppended$ = user$.pipe(
  rxjs.map(({ username }) =>
    newPointCoords$.pipe(
      rxjs.map((coords) =>
        coords
          ? appendClicks$.pipe(
              rxjs.map(() =>
                coords
                  ? post$("/map/points", {
                      user: username,
                      latitude: coords[0],
                      longitude: coords[1],
                      description: pointDescription.value.trim(),
                    })
                  : rxjs.EMPTY
              ),
              rxjs.switchAll()
            )
          : rxjs.EMPTY
      ),
      rxjs.switchAll()
    )
  ),
  rxjs.switchAll(),
  rxjs.share()
);

const pointVoted$ = user$.pipe(
  rxjs.map(({ username }) =>
    selectedPoint$.pipe(
      rxjs.map((placemark) =>
        voteClicks$.pipe(
          rxjs.map(() =>
            post$("/map/points/vote", {
              id: placemark.options.get("botPoint").id,
              user: username,
            })
          ),
          rxjs.switchAll()
        )
      ),
      rxjs.switchAll()
    )
  ),
  rxjs.switchAll(),
  rxjs.share()
);

const points$ = rxjs
  .merge(
    pointAppended$,
    rxjs
      .merge(ymaps$, refreshClicks$)
      .pipe(rxjs.mergeMap(() => get$("/map/points")))
  )
  .pipe(
    rxjs.map(({ points }) => points),
    rxjs.shareReplay(1)
  );

function renderPointBallonBody(point) {
  const parts = [];

  parts.push(
    `<p>Добавил ${point.createdBy} ${moment(point.createdAt).format("H:mm:ss")}`
  );

  if (point.description) {
    parts.push(`<p><b>Комментарий</b>:<br />${point.description}</p>`);
  }

  if (point.status === "created") {
    parts.push("<p>Точка еще никем не подтверждена</p>");
  } else if (point.status === "voted") {
    parts.push(
      `<p>Точка последний раз подтверждена ${moment(point.votedAt).format(
        "H:mm:ss"
      )}`
    );
  } else if (point.status === "unvoted-weak") {
    parts.push("Точка давно никем не подтверждалась");
  } else {
    parts.push("Точка очень давно никем не подтверждалась");
  }

  if (point.votes.length) {
    const text = [...point.votes]
      .reverse()
      .map(
        ({ createdAt, createdBy }) =>
          `${moment(createdAt).format("H:mm:ss")} подтвердил ${createdBy}`
      )
      .join("<br />");

    parts.push(`<p><b>Подтверждения</b><br />${text}</p>`);
  }

  return parts.join("");
}

function getPointPlacemarkColor(point) {
  return {
    created: "rgb(60, 170, 60)",
    votes: "red",
    "unvoted-weak": "rgba(60, 170, 60, 0.7)",
    "unvoted-strong": "rgba(60, 170, 60, 0.4)",
  }[point.status];
}

const placemarks$ = rxjs.combineLatest([points$, ymaps$]).pipe(
  rxjs.map(([points, ymaps]) =>
    points.map(
      (point) =>
        new ymaps.Placemark(
          [point.latitude, point.longitude],
          {
            balloonContentHeader: `${point.latitude.toPrecision(
              6
            )}, ${point.longitude.toPrecision(6)}`,
            balloonContentBody: renderPointBallonBody(point),
          },
          {
            preset: "islands#circleIcon",
            iconColor: getPointPlacemarkColor(point),
            botPoint: point,
          }
        )
    )
  ),
  rxjs.shareReplay(1)
);

const selectedPoint$ = placemarks$.pipe(
  rxjs.map((placemarks) => rxjs.from(placemarks)),
  rxjs.mergeAll(),
  rxjs.map((placemark) =>
    fromYMapsEvents(placemark, ["click", "mandala_bot:selected"]).pipe(
      rxjs.map(() => placemark)
    )
  ),
  rxjs.mergeAll()
);

const alerts$ = rxjs
  .merge(
    pointAppended$.pipe(
      rxjs.map(() => "Точка успешно создана"),
      rxjs.catchError(() => "Не удалось создать точку")
    ),
    pointVoted$.pipe(
      rxjs.map(() => "Подтверждение получено"),
      rxjs.catchError(() => "Не удалось подтвердить")
    )
  )
  .pipe(rxjs.share());

user$.subscribe(function ({ isAuthorized, username }) {
  userInfo.innerHTML = isAuthorized ? `Пользователь: ${username}` : "Гость";
});

newPointCoords$.subscribe(function (coords) {
  if (coords) {
    pointInfo.innerHTML = coords
      .map((coord) => coord.toPrecision(6))
      .join(", ");
    actionsPane.classList.add("visible");
  } else {
    actionsPane.classList.remove("visible");
  }
});

map$
  .pipe(
    rxjs.map((map) =>
      rxjs
        .of(
          cancelClicks$.pipe(rxjs.map(() => map)),
          voteCancelClicks$.pipe(rxjs.map(() => map)),
          pointAppended$.pipe(rxjs.map(() => map)),
          pointVoted$.pipe(rxjs.map(() => map))
        )
        .pipe(rxjs.mergeAll())
    ),
    rxjs.switchAll()
  )
  .subscribe(function (map) {
    map.balloon.close();
  });

rxjs
  .combineLatest([map$, newPointCoords$.pipe(rxjs.filter(Boolean))])
  .subscribe(function ([map, coords]) {
    map.balloon.open(coords, {
      contentHeader: "Новая точка",
      contentBody: `<p>Координаты точки: ${coords[0].toPrecision(
        5
      )}:${coords[1].toPrecision(6)}.`,
    });
  });

map$
  .pipe(
    rxjs.map((map) =>
      placemarks$.pipe(
        rxjs.map((placemarks) =>
          cluster$.pipe(
            rxjs.map((clusterData) => ({ map, placemarks, clusterData }))
          )
        ),
        rxjs.switchAll()
      )
    ),
    rxjs.switchAll()
  )
  .subscribe(function ({
    map,
    placemarks,
    clusterData: { isAppended, cluster },
  }) {
    if (isAppended) {
      cluster.removeAll();
      cluster.add(placemarks);
    } else {
      cluster.add(placemarks);
      map.geoObjects.add(cluster);
    }
  });

pointAppended$.subscribe(function () {
  pointDescription.value = "";
});

clusterPointSelected$.subscribe((object) => {
  object.events.fire("mandala_bot:selected");
});

rxjs
  .merge(selectedPoint$, balloonCloses$.pipe(rxjs.map(() => null)))
  .subscribe((selectedPoint) => {
    if (selectedPoint) {
      viewPane.classList.add("visible");
    } else {
      viewPane.classList.remove("visible");
    }
  });

alerts$.subscribe((alert) => {
  Telegram.WebApp.showAlert(alert);
});
